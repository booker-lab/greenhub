import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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

const RETENTION_BATCH_SIZE = 450;
const STORAGE_DELETE_ATTEMPTS = 3;
const SAFE_RECORD_ID_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/;

const RETENTION_POLICIES: Record<RetentionPurpose, RetentionPolicy> = {
  DELIVERY_PHOTO: {
    collection: 'deliveryPhotoRecords',
    expiresAt: (basisAt) => addUtcDays(basisAt, 90),
    allowedMetadata: new Set(['orderId', 'photoId', 'disputeStatus', 'legalHold']),
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

@Injectable()
export class RetentionService {
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
    for (const candidate of candidates) {
      const { collection, document } = candidate;
      const storagePath = document.data()['storagePath'];
      if (typeof storagePath === 'string' && storagePath.length > 0) {
        const deleted = await this.deleteStorageObject(collection, storagePath, document.data());
        if (!deleted) {
          failedCount += 1;
          continue;
        }
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
      deletedByPurpose,
    };
  }

  @Cron('0 3 * * *', { timeZone: 'Asia/Seoul' })
  async runScheduledPurge(): Promise<RetentionMetadata> {
    return this.purgeExpiredRecords({ now: new Date() });
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
    return firestore.db.batch() as unknown as RetentionBatch;
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
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= STORAGE_DELETE_ATTEMPTS; attempt += 1) {
      try {
        await this.storage.deleteObject(storagePath);
        return true;
      } catch {
        if (attempt < STORAGE_DELETE_ATTEMPTS) continue;
      }
    }

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
      },
    });
    return false;
  }
}
