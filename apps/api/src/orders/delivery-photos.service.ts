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
import { type DeliveryPhotoReconciliation, StorageService } from '../firestore/storage.service';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import { RetentionService } from '../retention/retention.service';
import { DriverOrderScopeService } from './driver-order-scope.service';
import { OrdersLifecycleService } from './orders-lifecycle.service';

type OrderRecord = Record<string, unknown>;

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

interface UploadDeliveryPhotoInput {
  storeId: string;
  orderId: string;
  requesterId: string;
  requesterRole: JwtPayload['role'];
  idempotencyKey: string;
  content: Buffer;
  contentType: string;
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
    if (input.contentType !== 'image/jpeg') {
      throw new BadRequestException('JPEG 배송 사진만 업로드할 수 있습니다.');
    }

    const photoId = this.createPhotoId(input.orderId, input.idempotencyKey);
    const contentSha256 = createHash('sha256').update(input.content).digest('hex');
    const order = await this.readOrder(input);
    await this.assertPreUploadEligibility(order, input, photoId);

    let uploaded: { orderId: string; photoId: string; path: string; created: boolean };
    try {
      uploaded = await this.storage.uploadDeliveryPhoto({
        storeId: input.storeId,
        orderId: input.orderId,
        photoId,
        requesterId: input.requesterId,
        requesterRole: input.requesterRole,
        content: input.content,
        contentType: 'image/jpeg',
      });
    } catch (error) {
      const reconciled = await this.reconcileStorageFailure(input, photoId, contentSha256, error);
      if (!reconciled) throw error;
      uploaded = reconciled;
    }

    let alreadyCompleted = false;
    try {
      alreadyCompleted = await this.attachPhoto({
        ...input,
        photoId,
        storagePath: uploaded.path,
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

    if (!alreadyCompleted) {
      await this.lifecycle.updateStatus(
        input.storeId,
        input.orderId,
        input.requesterId,
        { status: 'DELIVERED' },
        input.requesterRole,
      );
    } else {
      await this.lifecycle.reconcileDeliveryCompletion(input.storeId, input.orderId);
    }

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
    },
  ): Promise<boolean> {
    let alreadyCompleted = false;
    await this.firestore.runTransaction(async (transaction) => {
      const orderRef = this.firestore.doc(`orders/${input.orderId}`);
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists || snapshot.data()?.['storeId'] !== input.storeId) {
        throw new NotFoundException('주문을 찾을 수 없습니다.');
      }
      const order = snapshot.data() as OrderRecord;
      const photoIds = this.readPhotoIds(order['deliveryPhotoIds']);
      if (photoIds.includes(input.photoId) && order['status'] === 'DELIVERED') {
        await this.driverScope.assertPilotBaseInTransaction(transaction, order, input.storeId);
        const authority = await this.driverScope.assertDriverAuthorityInTransaction(
          transaction,
          input.requesterId,
          input.requesterRole,
        );
        if (order['driverId'] !== authority.requesterId) {
          throw new ForbiddenException('담당 기사만 배송 사진을 처리할 수 있습니다.');
        }
        alreadyCompleted = true;
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

      if (photoIds.includes(input.photoId)) return;
      if (photoIds.length > 0) {
        throw new ConflictException('배송 사진이 이미 연결되어 있습니다.');
      }

      const now = this.firestore.Timestamp.now();
      await this.retention.saveRecord({
        id: `${input.orderId}:${input.photoId}`,
        purpose: 'DELIVERY_PHOTO',
        basisAt: this.toDate(now),
        storagePath: input.storagePath,
        metadata: { orderId: input.orderId, photoId: input.photoId },
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
  ): Promise<void> {
    const photoIds = this.readPhotoIds(order['deliveryPhotoIds']);
    const isAttachedRetry = photoIds.includes(photoId) && order['status'] === 'DELIVERED';

    if (isAttachedRetry) {
      await this.driverScope.assertPilotBase(order, input.storeId);
      const authority = await this.driverScope.assertDriverAuthority(
        input.requesterId,
        input.requesterRole,
      );
      if (order['driverId'] !== authority.requesterId) {
        throw new ForbiddenException('담당 기사만 배송 사진을 처리할 수 있습니다.');
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

    if (photoIds.length > 0 && !photoIds.includes(photoId)) {
      throw new ConflictException('배송 사진이 이미 연결되어 있습니다.');
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
      throw new ConflictException(
        '같은 업로드 요청 식별자에 다른 배송 사진 또는 연결 상태가 있습니다.',
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
      throw new NotFoundException('주문을 찾을 수 없습니다.');
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
