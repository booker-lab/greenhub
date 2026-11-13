import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { FirestoreService } from '../firestore/firestore.service';
import { stripJpegMetadata } from '../firestore/jpeg-metadata';
import { type DeliveryPhotoReconciliation, StorageService } from '../firestore/storage.service';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import { RetentionService } from '../retention/retention.service';
import { DriverOrderScopeService } from './driver-order-scope.service';
import {
  throwDriverOrderAuthorityDenied,
  throwDriverOrderNotFound,
  throwDriverOrderStateConflict,
} from './driver-order-error';
import { OrdersLifecycleService } from './orders-lifecycle.service';

type OrderRecord = Record<string, unknown>;

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * 촬영 때 기사 앱이 본 주문 보류 표시(deliveryHold.heldAt). 'none'은 그때 보류 이력이 없었다는 뜻이다.
 * 값은 서버가 쓴 ISO 시각을 그대로 돌려받으므로 형식만 좁게 본다.
 */
export const DELIVERY_PHOTO_NO_HOLD = 'none';
const EXPECTED_HOLD_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * 촬영 뒤 새 보류가 생겼다(보류 → 다시 배송 중). 예전 사진으로 재배송을 완료하지 않는다.
 * 기존 기사 오류 코드(DRIVER_ORDER_*)와 구분되는 이 경로 전용 코드다.
 */
export const DELIVERY_PHOTO_STALE_HOLD = 'DELIVERY_PHOTO_STALE_HOLD';

/**
 * 같은 키·같은 사진 재전송을 이미 끝난 완료로 받아 줄 주문 상태.
 * 기사 앱은 응답을 잃은 사진을 기기에 두었다가 나중에 다시 보내므로(사진 업로드 대기열),
 * 그 사이 손님이 후기를 남겨 REVIEWED가 됐어도 같은 사진이 이미 연결돼 있으면 완료로 수렴한다.
 * REVIEWED 재전송은 상태 전이·정산·완료 알림을 새로 만들지 않는다.
 */
const COMPLETED_RETRY_STATUSES: readonly unknown[] = ['DELIVERED', 'REVIEWED'];

type CompletedRetryStatus = 'DELIVERED' | 'REVIEWED';

/** undefined: 확인하지 않음, null: 촬영 때 보류 이력 없음, 문자열: 그때 본 heldAt. */
type ExpectedHoldAt = string | null | undefined;

function isCompletedRetryStatus(status: unknown): status is CompletedRetryStatus {
  return COMPLETED_RETRY_STATUSES.includes(status);
}

interface UploadDeliveryPhotoInput {
  storeId: string;
  orderId: string;
  requesterId: string;
  requesterRole: JwtPayload['role'];
  idempotencyKey: string;
  content: Buffer;
  contentType: string;
  /**
   * 촬영 때 본 보류 표시. 없으면(이전 앱) 확인하지 않는다. null은 그때 보류 이력이 없었다는 뜻이다.
   * 문자열 그대로(검사 전 값)를 받아 서비스가 형식을 판정한다.
   */
  expectedHoldAt?: unknown;
}

interface ReadDeliveryPhotoInput {
  storeId: string;
  orderId: string;
  photoId: string;
  requesterId: string;
  requesterRole: JwtPayload['role'];
}

@Injectable()
export class DeliveryPhotosService {
  constructor(
    @Inject(FirestoreService)
    private readonly firestore: FirestoreService,
    @Inject(StorageService)
    private readonly storage: StorageService,
    @Inject(RetentionService)
    private readonly retention: RetentionService,
    @Inject(OrdersLifecycleService)
    private readonly lifecycle: OrdersLifecycleService,
    @Inject(DriverOrderScopeService)
    private readonly driverScope: DriverOrderScopeService,
    @Inject(OperationIssueWriterService)
    private readonly issueWriter: OperationIssueWriterService,
  ) {}

  async uploadAndComplete(input: UploadDeliveryPhotoInput) {
    this.assertSafeId(input.storeId, 'storeId');
    this.assertSafeId(input.orderId, 'orderId');
    this.assertIdempotencyKey(input.idempotencyKey);
    const expectedHoldAt = this.parseExpectedHoldAt(input.expectedHoldAt);
    if (input.contentType !== 'image/jpeg') {
      throw new BadRequestException('JPEG 배송 사진만 업로드할 수 있습니다.');
    }

    const photoId = this.createPhotoId(input.orderId, input.idempotencyKey);
    // Storage가 저장하는 것과 같은 메타데이터 제거 후 바이트로 해시·재조정을 맞춘다.
    const content = stripJpegMetadata(input.content);
    const contentSha256 = createHash('sha256').update(content).digest('hex');
    const order = await this.readOrder(input);
    await this.assertPreUploadEligibility(order, input, photoId, expectedHoldAt);

    let uploaded: { orderId: string; photoId: string; path: string; created: boolean };
    try {
      uploaded = await this.storage.uploadDeliveryPhoto({
        storeId: input.storeId,
        orderId: input.orderId,
        photoId,
        requesterId: input.requesterId,
        requesterRole: input.requesterRole,
        content,
        contentType: 'image/jpeg',
      });
    } catch (error) {
      const reconciled = await this.reconcileStorageFailure(input, photoId, contentSha256, error);
      if (!reconciled) throw error;
      uploaded = reconciled;
    }

    let alreadyCompleted: CompletedRetryStatus | null = null;
    try {
      alreadyCompleted = await this.attachPhoto({
        ...input,
        photoId,
        storagePath: uploaded.path,
        expectedHoldAt,
      });
    } catch (error) {
      if (uploaded.created) {
        try {
          await this.storage.deleteObject(uploaded.path);
        } catch {
          await this.recordReconciliationIssue({
            input,
            photoId,
            storagePath: uploaded.path,
            contentSha256,
            failureStage: 'attach_compensation_delete',
            failureClass: 'STORAGE_DELETE_FAILED',
            attemptCount: 1,
            reconciliationState: 'CLEANUP_PENDING',
          });
        }
      } else {
        await this.recordReconciliationIssue({
          input,
          photoId,
          storagePath: uploaded.path,
          contentSha256,
          failureStage: 'attach_transaction',
          failureClass: 'ATTACH_REJECTED_OBJECT_OWNERSHIP_UNCERTAIN',
          attemptCount: 0,
          reconciliationState: 'CLEANUP_PENDING',
        });
      }
      throw error;
    }

    if (alreadyCompleted === null) {
      await this.lifecycle.updateStatus(
        input.storeId,
        input.orderId,
        input.requesterId,
        { status: 'DELIVERED' },
        input.requesterRole,
      );
    } else if (alreadyCompleted === 'DELIVERED') {
      await this.lifecycle.reconcileDeliveryCompletion(input.storeId, input.orderId);
    }
    // REVIEWED: 배송 완료 후속효과(정산·완료 알림)는 DELIVERED 단계에서 이미 지났다.
    // 같은 사진 재전송은 새 전이·정산·알림 없이 완료 응답만 돌려준다.

    return { orderId: input.orderId, photoId, status: 'DELIVERED' as const };
  }

  async createReadUrl(input: ReadDeliveryPhotoInput) {
    const signed = await this.storage.createDeliveryPhotoReadUrl(input);
    return {
      orderId: input.orderId,
      photoId: input.photoId,
      ...signed,
    };
  }

  private async attachPhoto(
    input: UploadDeliveryPhotoInput & {
      photoId: string;
      storagePath: string;
      expectedHoldAt: ExpectedHoldAt;
    },
  ): Promise<CompletedRetryStatus | null> {
    let alreadyCompleted: CompletedRetryStatus | null = null;
    await this.firestore.runTransaction(async (transaction) => {
      const orderRef = this.firestore.doc(`orders/${input.orderId}`);
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists || snapshot.data()?.['storeId'] !== input.storeId) {
        throwDriverOrderNotFound('주문을 찾을 수 없습니다.');
      }
      const order = snapshot.data() as OrderRecord;
      const photoIds = this.readPhotoIds(order['deliveryPhotoIds']);
      const status = order['status'];
      if (photoIds.includes(input.photoId) && isCompletedRetryStatus(status)) {
        try {
          await this.driverScope.assertPilotBaseInTransaction(transaction, order, input.storeId);
        } catch (error) {
          if (!(error instanceof ForbiddenException)) throw error;
          await this.assertHistoricalPilotBaseInTransaction(
            transaction,
            order,
            input.storeId,
            input.photoId,
          );
        }
        const authority = await this.driverScope.assertDriverAuthorityInTransaction(
          transaction,
          input.requesterId,
          input.requesterRole,
        );
        if (order['driverId'] !== authority.requesterId) {
          throwDriverOrderAuthorityDenied('담당 기사만 배송 사진을 처리할 수 있습니다.');
        }
        alreadyCompleted = status;
        return;
      }

      await this.driverScope.assertMutationEligibilityInTransaction(transaction, {
        requesterId: input.requesterId,
        requesterRole: input.requesterRole,
        storeId: input.storeId,
        order,
        expectedStatus: 'DELIVERING',
        nextStatus: 'DELIVERED',
      });
      // 사진을 연결하거나(처음) 연결된 사진으로 완료하기(전이만 빠졌던 재전송) 전에 본다.
      this.assertHoldUnchangedSinceCapture(order, input.expectedHoldAt);

      if (photoIds.includes(input.photoId)) return;
      if (photoIds.length > 0) {
        throwDriverOrderStateConflict('배송 사진이 이미 연결되어 있습니다.', true);
      }

      const now = this.firestore.Timestamp.now();
      await this.retention.saveRecord({
        id: `${input.orderId}:${input.photoId}`,
        purpose: 'DELIVERY_PHOTO',
        basisAt: this.toDate(now),
        storagePath: input.storagePath,
        metadata: { orderId: input.orderId, photoId: input.photoId, storeId: input.storeId },
        transaction,
      });
      transaction.update(orderRef, {
        deliveryPhotoIds: [input.photoId],
        updatedAt: now,
      });
    });
    return alreadyCompleted;
  }

  private async assertPreUploadEligibility(
    order: OrderRecord,
    input: UploadDeliveryPhotoInput,
    photoId: string,
    expectedHoldAt: ExpectedHoldAt,
  ): Promise<void> {
    const photoIds = this.readPhotoIds(order['deliveryPhotoIds']);
    const isAttachedRetry = photoIds.includes(photoId) && isCompletedRetryStatus(order['status']);

    if (isAttachedRetry) {
      try {
        await this.driverScope.assertPilotBase(order, input.storeId);
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
        await this.assertHistoricalPilotBase(order, input.storeId, photoId);
      }
      const authority = await this.driverScope.assertDriverAuthority(
        input.requesterId,
        input.requesterRole,
      );
      if (order['driverId'] !== authority.requesterId) {
        throwDriverOrderAuthorityDenied('담당 기사만 배송 사진을 처리할 수 있습니다.');
      }
      return;
    }

    await this.driverScope.assertMutationEligibility({
      requesterId: input.requesterId,
      requesterRole: input.requesterRole,
      storeId: input.storeId,
      order,
      expectedStatus: 'DELIVERING',
      nextStatus: 'DELIVERED',
    });
    // Storage 객체를 쓰기 전에 거절한다. 그 사이 보류가 생기면 연결 트랜잭션이 다시 거절하고
    // 이번 요청이 만든 객체를 지운다(attach 실패 보상 경로).
    this.assertHoldUnchangedSinceCapture(order, expectedHoldAt);

    if (photoIds.length > 0 && !photoIds.includes(photoId)) {
      throwDriverOrderStateConflict('배송 사진이 이미 연결되어 있습니다.', true);
    }
  }

  private async assertHistoricalPilotBase(
    order: OrderRecord,
    storeId: string,
    photoId: string,
  ): Promise<void> {
    const photoIds = this.readPhotoIds(order['deliveryPhotoIds']);
    if (
      order['storeId'] !== storeId ||
      order['schemaVersion'] !== 2 ||
      typeof order['roundId'] !== 'string' ||
      order['roundId'].trim().length === 0 ||
      order['deliveryMethod'] !== 'direct' ||
      !isCompletedRetryStatus(order['status']) ||
      !photoIds.includes(photoId)
    ) {
      throwDriverOrderAuthorityDenied('유효한 round_direct Pilot 주문이 아닙니다.');
    }
    const roundId = order['roundId'];
    const snapshot = await this.firestore.doc(`saleRounds/${roundId}`).get();
    if (!snapshot.exists) {
      throwDriverOrderAuthorityDenied('유효한 round_direct Pilot 주문이 아닙니다.');
    }
    const round = snapshot.data();
    if (round?.['id'] !== order['roundId'] || round?.['storeId'] !== order['storeId']) {
      throwDriverOrderAuthorityDenied('유효한 round_direct Pilot 주문이 아닙니다.');
    }
  }

  private async assertHistoricalPilotBaseInTransaction(
    transaction: { get: (ref: unknown) => Promise<{ exists: boolean; data: () => unknown }> },
    order: OrderRecord,
    storeId: string,
    photoId: string,
  ): Promise<void> {
    const photoIds = this.readPhotoIds(order['deliveryPhotoIds']);
    if (
      order['storeId'] !== storeId ||
      order['schemaVersion'] !== 2 ||
      typeof order['roundId'] !== 'string' ||
      order['roundId'].trim().length === 0 ||
      order['deliveryMethod'] !== 'direct' ||
      !isCompletedRetryStatus(order['status']) ||
      !photoIds.includes(photoId)
    ) {
      throwDriverOrderAuthorityDenied('유효한 round_direct Pilot 주문이 아닙니다.');
    }
    const roundId = order['roundId'];
    const snapshot = await transaction.get(this.firestore.doc(`saleRounds/${roundId}`));
    if (!snapshot.exists) {
      throwDriverOrderAuthorityDenied('유효한 round_direct Pilot 주문이 아닙니다.');
    }
    const round = snapshot.data() as OrderRecord | undefined;
    if (round?.['id'] !== order['roundId'] || round?.['storeId'] !== order['storeId']) {
      throwDriverOrderAuthorityDenied('유효한 round_direct Pilot 주문이 아닙니다.');
    }
  }

  private async reconcileStorageFailure(
    input: UploadDeliveryPhotoInput,
    photoId: string,
    contentSha256: string,
    error: unknown,
  ): Promise<{ orderId: string; photoId: string; path: string; created: boolean } | null> {
    if (this.isKnownStorageRejection(error)) return null;

    let reconciliation: DeliveryPhotoReconciliation;
    try {
      reconciliation = await this.storage.reconcileDeliveryPhoto({
        storeId: input.storeId,
        orderId: input.orderId,
        photoId,
        contentSha256,
      });
    } catch {
      reconciliation = {
        state: 'OUTCOME_UNKNOWN',
        orderId: input.orderId,
        photoId,
        path: `deliveryPhotos/${input.orderId}/${photoId}.jpg`,
        objectExists: null,
        attached: null,
      };
    }

    if (reconciliation.state === 'ATTACHED' || reconciliation.state === 'CLEANUP_PENDING') {
      return {
        orderId: input.orderId,
        photoId,
        path: reconciliation.path,
        created: false,
      };
    }

    if (reconciliation.state === 'CONFLICT') {
      throwDriverOrderStateConflict(
        '같은 업로드 요청 식별자에 다른 배송 사진 또는 연결 상태가 있습니다.',
        true,
      );
    }

    if (reconciliation.state === 'OUTCOME_UNKNOWN') {
      await this.recordReconciliationIssue({
        input,
        photoId,
        storagePath: reconciliation.path,
        contentSha256,
        failureStage: 'storage_write',
        failureClass: 'STORAGE_WRITE_OUTCOME_UNKNOWN',
        attemptCount: 1,
        reconciliationState: 'OUTCOME_UNKNOWN',
      });
    }

    return null;
  }

  private async recordReconciliationIssue(input: {
    input: UploadDeliveryPhotoInput;
    photoId: string;
    storagePath: string;
    contentSha256: string;
    failureStage: string;
    failureClass: string;
    attemptCount: number;
    reconciliationState: string;
  }): Promise<void> {
    const snapshot = {
      storeId: input.input.storeId,
      orderId: input.input.orderId,
      photoId: input.photoId,
      storagePath: input.storagePath,
      logicalRequestId: input.input.idempotencyKey,
      contentSha256: input.contentSha256,
      failureStage: input.failureStage,
      attemptCount: input.attemptCount,
      failureClass: input.failureClass,
      reconciliationState: input.reconciliationState,
    };

    await this.issueWriter.createOrMergeIssue({
      ...snapshot,
      type: 'DELIVERY_PHOTO_RECONCILIATION_REQUIRED',
      severity: 'critical',
      title: '배송 사진 Storage 재조정 필요',
      message: '배송 사진 처리 중 영속 상태를 자동으로 확정하지 못해 운영 확인이 필요합니다.',
      idempotencyKey: `delivery-photo-reconciliation:${input.input.orderId}:${input.photoId}:${input.contentSha256}`,
      latestSnapshot: snapshot,
    });
  }

  private async readOrder(input: Pick<UploadDeliveryPhotoInput, 'storeId' | 'orderId'>) {
    const snapshot = await this.firestore.doc(`orders/${input.orderId}`).get();
    if (!snapshot.exists || snapshot.data()?.['storeId'] !== input.storeId) {
      throwDriverOrderNotFound('주문을 찾을 수 없습니다.');
    }
    return snapshot.data() as OrderRecord;
  }

  private isKnownStorageRejection(error: unknown): boolean {
    return (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof ForbiddenException ||
      error instanceof NotFoundException
    );
  }

  private assertSafeId(value: string, field: string): void {
    if (value.length > 128 || !SAFE_ID_PATTERN.test(value)) {
      throw new BadRequestException(`${field} 형식이 올바르지 않습니다.`);
    }
  }

  private createPhotoId(orderId: string, idempotencyKey: string): string {
    return createHash('sha256').update(`${orderId}:${idempotencyKey}`).digest('hex').slice(0, 32);
  }

  /** undefined: 확인하지 않는다(이전 앱). null: 촬영 때 보류 이력이 없었다. */
  private parseExpectedHoldAt(value: unknown): ExpectedHoldAt {
    if (value === undefined) return undefined;
    if (value === DELIVERY_PHOTO_NO_HOLD) return null;
    if (typeof value === 'string' && value.length <= 40 && EXPECTED_HOLD_AT_PATTERN.test(value)) {
      return value;
    }
    throw new BadRequestException('촬영 때 보류 표시 형식이 올바르지 않습니다.');
  }

  /**
   * 촬영 뒤 새 보류가 생겼으면(heldAt이 달라졌으면) 거절한다. 보류는 매번 새 heldAt을 쓰고 재개 뒤에도
   * 남으므로, 시각 비교 없이 같은 값인지만 본다(기기 시계와 무관하다).
   * 이미 같은 사진으로 완료된 주문(DELIVERED·REVIEWED ACK)은 이 판정 전에 끝난다.
   */
  private assertHoldUnchangedSinceCapture(order: OrderRecord, expected: ExpectedHoldAt): void {
    if (expected === undefined) return;
    const heldAt = (order['deliveryHold'] as OrderRecord | null | undefined)?.['heldAt'];
    const current = typeof heldAt === 'string' && heldAt.trim().length > 0 ? heldAt : null;
    if (current === expected) return;
    throw new ConflictException({
      statusCode: 409,
      message: '사진을 찍은 뒤 배송 보류가 있었습니다. 다시 배송할 때 찍은 사진만 쓸 수 있습니다.',
      error: 'Conflict',
      code: DELIVERY_PHOTO_STALE_HOLD,
    });
  }

  private assertIdempotencyKey(value: string) {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
      throw new BadRequestException('업로드 요청 식별자 형식이 올바르지 않습니다.');
    }
  }

  private readPhotoIds(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((photoId): photoId is string => typeof photoId === 'string')
      : [];
  }

  private toDate(value: unknown): Date {
    if (value instanceof Date) return value;
    const timestamp = value as { toDate?: () => Date };
    return typeof timestamp?.toDate === 'function' ? timestamp.toDate() : new Date();
  }
}
