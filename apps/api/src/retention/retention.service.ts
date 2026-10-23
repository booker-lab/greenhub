import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { acquireJobLease, completeJobLease, seoulDailySlotKey } from '../common/job-lease';
import { FirestoreService } from '../firestore/firestore.service';
import { StorageService } from '../firestore/storage.service';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';

type RetentionPurpose = 'DELIVERY_PHOTO' | 'MARKETING_CONSENT' | 'LEGAL_ORDER' | 'LEGAL_DISPUTE';

type RetentionMetadata = Record<string, unknown>;

interface StorageDeletionAdapter {
  deleteObject(path: string): Promise<void>;
}

interface RetentionPolicy {
  collection: string;
  expiresAt: (basisAt: Date) => Date;
  allowedMetadata: ReadonlySet<string>;
}

interface RetentionDocumentSnapshot {
  data(): RetentionMetadata;
  ref: unknown;
}

interface RetentionQuerySnapshot {
  docs: RetentionDocumentSnapshot[];
  empty: boolean;
}

interface RetentionBatch {
  delete(ref: unknown): RetentionBatch;
  commit(): Promise<unknown>;
}

interface RetentionTransaction {
  set(ref: unknown, data: RetentionMetadata): void;
}

interface LegalHoldTransaction {
  get(refOrQuery: unknown): Promise<unknown>;
  update(ref: unknown, data: RetentionMetadata): unknown;
}

/** 객체 삭제 결과. 이미 없는 객체(NOT_FOUND)는 삭제된 것으로 본다. */
type StorageDeleteOutcome = 'DELETED' | 'NOT_FOUND' | 'FAILED';

/** 삭제 실패 원인. 오류 메시지·경로는 담지 않고 오류 종류와 코드만 남긴다. */
interface StorageDeleteFailureCause {
  errorName: string;
  errorCode: string | null;
}

const RETENTION_BATCH_SIZE = 450;
const RETENTION_PURGE_JOB_NAME = 'retention-scheduled-purge';
const RETENTION_PURGE_LEASE_TTL_MS = 2 * 60 * 60 * 1000;
const STORAGE_DELETE_ATTEMPTS = 3;
const SAFE_RECORD_ID_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/;
const SAFE_ERROR_TOKEN_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const SAFE_ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const RETENTION_POLICIES: Record<RetentionPurpose, RetentionPolicy> = {
  DELIVERY_PHOTO: {
    collection: 'deliveryPhotoRecords',
    expiresAt: (basisAt) => addUtcDays(basisAt, 90),
    allowedMetadata: new Set(['orderId', 'photoId', 'storeId', 'disputeStatus', 'legalHold']),
  },
  MARKETING_CONSENT: {
    collection: 'marketingConsentLogs',
    expiresAt: (basisAt) => addUtcYears(basisAt, 3),
    allowedMetadata: new Set([
      'orderId',
      'userId',
      'agreed',
      'policyVersion',
      'channels',
      'recordType',
    ]),
  },
  LEGAL_ORDER: {
    collection: 'legalOrderRecords',
    expiresAt: (basisAt) => addUtcYears(basisAt, 5),
    allowedMetadata: new Set([
      'orderId',
      'paymentId',
      'storeId',
      'userId',
      'recordTypes',
      'amount',
      'payMethod',
      'orderStatus',
      'paymentStatus',
      'legalHold',
    ]),
  },
  LEGAL_DISPUTE: {
    collection: 'legalDisputeRecords',
    expiresAt: (basisAt) => addUtcYears(basisAt, 3),
    allowedMetadata: new Set([
      'orderId',
      'paymentId',
      'storeId',
      'userId',
      'recordTypes',
      'amount',
      'orderStatus',
      'paymentStatus',
      'disputeStatus',
      'legalHold',
    ]),
  },
};

const RETENTION_COLLECTIONS = Object.values(RETENTION_POLICIES).map(({ collection }) => collection);

/** 보존 보류를 걸 수 있는 주문 연결 보관 기록 컬렉션(마케팅 동의 기록은 주문 분쟁 증빙이 아니다). */
const LEGAL_HOLD_COLLECTIONS = Object.values(RETENTION_POLICIES)
  .filter(({ allowedMetadata }) => allowedMetadata.has('legalHold'))
  .map(({ collection }) => collection);

function addUtcDays(value: Date, days: number): Date {
  const result = new Date(value.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addUtcYears(value: Date, years: number): Date {
  const result = new Date(value.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function safeErrorToken(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  if (typeof value === 'string' && SAFE_ERROR_TOKEN_PATTERN.test(value)) return value;
  return null;
}

type StorageErrorShape = {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  response?: { status?: unknown } | null;
};

function describeStorageDeleteError(error: unknown): StorageDeleteFailureCause {
  if (typeof error !== 'object' || error === null) {
    return { errorName: typeof error, errorCode: null };
  }
  const shape = error as StorageErrorShape;
  // Storage SDK 오류(ApiError)는 name이 'Error'로 남아 있어 클래스 이름을 쓴다.
  const name =
    shape.name === 'Error' || shape.name === undefined ? error.constructor?.name : shape.name;
  return {
    errorName: safeErrorToken(name) ?? 'UnknownError',
    errorCode:
      safeErrorToken(shape.code) ??
      safeErrorToken(shape.status) ??
      safeErrorToken(shape.statusCode) ??
      safeErrorToken(shape.response?.status),
  };
}

function isStorageNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const shape = error as StorageErrorShape;
  if (shape.code === 'NOT_FOUND') return true;
  return [shape.code, shape.status, shape.statusCode, shape.response?.status].some(
    (value) => value === 404 || value === '404',
  );
}

@Injectable()
export class RetentionService {
  private readonly retentionLogger = new Logger(RetentionService.name);

  constructor(
    private readonly firestore: FirestoreService,
    @Inject(StorageService)
    private readonly storage: StorageDeletionAdapter,
    private readonly issueWriter: OperationIssueWriterService,
  ) {}

  async saveRecord(input: {
    id: string;
    purpose: RetentionPurpose;
    basisAt: Date;
    storagePath?: string;
    metadata?: RetentionMetadata;
    transaction?: RetentionTransaction;
  }): Promise<RetentionMetadata> {
    const policy = RETENTION_POLICIES[input.purpose];
    this.assertRecordId(input.id);
    this.assertAllowedMetadata(policy, input.metadata ?? {});
    const expiresAt = this.firestore.Timestamp.fromDate(policy.expiresAt(input.basisAt));
    const data = {
      ...(input.metadata ?? {}),
      purpose: input.purpose,
      basisAt: this.firestore.Timestamp.fromDate(input.basisAt),
      expiresAt,
      ...(input.storagePath ? { storagePath: input.storagePath } : {}),
    };

    const ref = this.firestore.doc(`${policy.collection}/${input.id}`);
    if (input.transaction) input.transaction.set(ref, data);
    else await ref.set(data);

    return {
      id: input.id,
      purpose: input.purpose,
      collection: policy.collection,
      expiresAt,
    };
  }

  async purgeExpiredRecords(input: { now: Date }): Promise<RetentionMetadata> {
    const now = this.firestore.Timestamp.fromDate(input.now);
    const expiredSnapshots = await Promise.all(
      RETENTION_COLLECTIONS.map(async (collection) => {
        const snapshot = (await this.firestore
          .collection(collection)
          .where('expiresAt', '<=', now)
          .get()) as RetentionQuerySnapshot;
        return { collection, snapshot };
      }),
    );
    const candidates = expiredSnapshots.flatMap(({ collection, snapshot }) =>
      snapshot.docs
        .filter((document) => this.canPurge(document.data()))
        .map((document) => ({ collection, document })),
    );

    if (candidates.length === 0) {
      return { deletedCount: 0, deletedByPurpose: {} };
    }

    const deletable: typeof candidates = [];
    let failedCount = 0;
    let storageNotFoundCount = 0;
    for (const candidate of candidates) {
      const { collection, document } = candidate;
      const storagePath = document.data()['storagePath'];
      if (typeof storagePath === 'string' && storagePath.length > 0) {
        const outcome = await this.deleteStorageObject(collection, storagePath, document.data());
        if (outcome === 'FAILED') {
          failedCount += 1;
          continue;
        }
        if (outcome === 'NOT_FOUND') storageNotFoundCount += 1;
      }
      deletable.push(candidate);
    }

    const deletedByPurpose: Record<string, number> = {};
    for (let offset = 0; offset < deletable.length; offset += RETENTION_BATCH_SIZE) {
      const batch = this.createBatch();
      for (const { collection, document } of deletable.slice(
        offset,
        offset + RETENTION_BATCH_SIZE,
      )) {
        batch.delete(document.ref);
        deletedByPurpose[collection] = (deletedByPurpose[collection] ?? 0) + 1;
      }
      await batch.commit();
    }

    return {
      deletedCount: deletable.length,
      failedCount,
      storageNotFoundCount,
      deletedByPurpose,
    };
  }

  /**
   * 주문에 연결된 보관 기록(배송 사진·계약/결제·환불/분쟁)의 보존 보류를 설정하거나 해제한다.
   * 보류가 설정된 기록은 만료일이 지나도 파기하지 않는다(canPurge).
   */
  async setOrderLegalHold(input: {
    orderId: string;
    hold: boolean;
    reason: string;
    actorId: string;
  }): Promise<RetentionMetadata> {
    if (!SAFE_ORDER_ID_PATTERN.test(input.orderId)) {
      throw new BadRequestException('주문 식별자 형식이 올바르지 않습니다.');
    }
    const orderRef = this.firestore.doc(`orders/${input.orderId}`);

    return this.firestore.runTransaction(async (rawTx) => {
      const tx = rawTx as unknown as LegalHoldTransaction;
      const order = (await tx.get(orderRef)) as { exists: boolean };
      if (!order.exists) {
        throw new NotFoundException('주문을 찾을 수 없습니다.');
      }

      const snapshots = await Promise.all(
        LEGAL_HOLD_COLLECTIONS.map(async (collection) => {
          const snapshot = (await tx.get(
            this.firestore.collection(collection).where('orderId', '==', input.orderId),
          )) as RetentionQuerySnapshot;
          return { collection, snapshot };
        }),
      );

      const now = this.firestore.Timestamp.now();
      const updatedByPurpose: Record<string, number> = {};
      let updatedCount = 0;
      for (const { collection, snapshot } of snapshots) {
        for (const document of snapshot.docs) {
          tx.update(document.ref, {
            legalHold: input.hold,
            legalHoldReason: input.reason,
            legalHoldUpdatedBy: input.actorId,
            legalHoldUpdatedAt: now,
          });
          updatedByPurpose[collection] = (updatedByPurpose[collection] ?? 0) + 1;
          updatedCount += 1;
        }
      }

      // 사유 원문·주문 식별자는 로그에 남기지 않는다(기록 문서에만 저장).
      this.retentionLogger.log(
        `[RetentionLegalHold] hold=${input.hold} updatedCount=${updatedCount} actor=${input.actorId}`,
      );

      return {
        orderId: input.orderId,
        legalHold: input.hold,
        updatedCount,
        updatedByPurpose,
      };
    });
  }

  // 인스턴스가 여럿 떠 있어도(배포 겹침·복제본) 하루 한 번만 돌도록 회차 lease를 잡는다.
  // lease를 잡지 못하면(이미 끝남·다른 실행 중·저장소 장애) 로그만 남기고 건너뛴다.
  @Cron('0 3 * * *', { timeZone: 'Asia/Seoul' })
  async runScheduledPurge(): Promise<RetentionMetadata> {
    const now = new Date();
    const acquired = await acquireJobLease(this.firestore, {
      jobName: RETENTION_PURGE_JOB_NAME,
      slotKey: seoulDailySlotKey(now),
      ttlMs: RETENTION_PURGE_LEASE_TTL_MS,
      logger: this.retentionLogger,
    });
    if (acquired.status !== 'ACQUIRED') {
      return { skipped: true, reason: acquired.status };
    }
    try {
      const result = await this.purgeExpiredRecords({ now });
      // 무엇을 몇 건 지웠는지 남긴다(문서 내용·경로는 남기지 않는다).
      this.retentionLogger.log(`[RetentionScheduler] ${JSON.stringify(result)}`);
      await completeJobLease(this.firestore, acquired.lease, {
        succeeded: true,
        logger: this.retentionLogger,
      });
      return result;
    } catch (error) {
      this.retentionLogger.error(
        `[RetentionScheduler] 보관 기한 삭제 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      // 실패한 회차는 완료로 남기지 않고 lease만 풀어 다시 시도할 수 있게 한다.
      await completeJobLease(this.firestore, acquired.lease, {
        succeeded: false,
        logger: this.retentionLogger,
      });
      throw error;
    }
  }

  private canPurge(data: RetentionMetadata): boolean {
    return data['disputeStatus'] !== 'OPEN' && data['legalHold'] !== true;
  }

  private createBatch(): RetentionBatch {
    const firestore = this.firestore as FirestoreService & {
      batch?: () => RetentionBatch;
    };
    if (typeof firestore.batch === 'function') {
      return firestore.batch();
    }
    return firestore.db.batch();
  }

  private assertRecordId(id: string): void {
    if (!SAFE_RECORD_ID_PATTERN.test(id)) {
      throw new BadRequestException('보관 기록 식별자 형식이 올바르지 않습니다.');
    }
  }

  private assertAllowedMetadata(policy: RetentionPolicy, metadata: RetentionMetadata): void {
    const rejected = Object.keys(metadata).filter((field) => !policy.allowedMetadata.has(field));
    if (rejected.length > 0) {
      throw new BadRequestException('허용되지 않은 보관 metadata 필드가 있습니다.');
    }
  }

  private async deleteStorageObject(
    collection: string,
    storagePath: string,
    data: RetentionMetadata,
  ): Promise<StorageDeleteOutcome> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= STORAGE_DELETE_ATTEMPTS; attempt += 1) {
      try {
        await this.storage.deleteObject(storagePath);
        return 'DELETED';
      } catch (error) {
        // 이미 없는 객체는 파기가 끝난 것으로 본다.
        if (isStorageNotFoundError(error)) return 'NOT_FOUND';
        lastError = error;
      }
    }

    const cause = describeStorageDeleteError(lastError);
    // 경로에는 주문 식별자가 들어 있어 로그에는 컬렉션과 오류 종류·코드만 남긴다.
    this.retentionLogger.error(
      `[RetentionPurge] 보관 객체 삭제 최종 실패: collection=${collection} attempts=${STORAGE_DELETE_ATTEMPTS} errorName=${cause.errorName} errorCode=${cause.errorCode ?? 'none'}`,
    );

    await this.issueWriter.createOrMergeIssue({
      storeId: String(data['storeId'] ?? ''),
      orderId: String(data['orderId'] ?? ''),
      type: 'RETENTION_DELETE_FAILED',
      severity: 'critical',
      title: '보관 객체 삭제 최종 실패',
      message: '만료된 보관 객체를 삭제하지 못해 운영 확인이 필요합니다.',
      idempotencyKey: `retention-delete-failed:${collection}:${storagePath}`,
      latestSnapshot: {
        collection,
        failureStage: 'storage_delete',
        attempts: STORAGE_DELETE_ATTEMPTS,
        errorName: cause.errorName,
        errorCode: cause.errorCode,
      },
    });
    return 'FAILED';
  }
}
