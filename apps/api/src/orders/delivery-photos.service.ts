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
import { StorageService } from '../firestore/storage.service';
import { RetentionService } from '../retention/retention.service';
import { OrdersLifecycleService } from './orders-lifecycle.service';

type OrderRecord = Record<string, unknown>;

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
  ) {}

  async uploadAndComplete(input: UploadDeliveryPhotoInput) {
    this.assertIdempotencyKey(input.idempotencyKey);
    if (input.contentType !== 'image/jpeg') {
      throw new BadRequestException('JPEG 배송 사진만 업로드할 수 있습니다.');
    }

    const photoId = this.createPhotoId(input.orderId, input.idempotencyKey);
    const uploaded = await this.storage.uploadDeliveryPhoto({
      storeId: input.storeId,
      orderId: input.orderId,
      photoId,
      requesterId: input.requesterId,
      requesterRole: input.requesterRole,
      content: input.content,
      contentType: 'image/jpeg',
    });

    let alreadyCompleted = false;
    try {
      alreadyCompleted = await this.attachPhoto({
        ...input,
        photoId,
        storagePath: uploaded.path,
      });
    } catch (error) {
      if (uploaded.created) {
        await this.storage.deleteObject(uploaded.path).catch(() => undefined);
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
      this.assertRoundDirectDriver(order, input);

      const photoIds = this.readPhotoIds(order['deliveryPhotoIds']);
      if (photoIds.includes(input.photoId)) {
        alreadyCompleted = order['status'] === 'DELIVERED';
        return;
      }
      if (photoIds.length > 0) {
        throw new ConflictException('배송 사진이 이미 연결되어 있습니다.');
      }
      if (order['status'] !== 'DELIVERING') {
        throw new ForbiddenException('배송 중인 주문에만 사진을 연결할 수 있습니다.');
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

  private assertRoundDirectDriver(order: OrderRecord, input: UploadDeliveryPhotoInput) {
    if (
      order['schemaVersion'] !== 2 ||
      typeof order['roundId'] !== 'string' ||
      order['roundId'].length === 0 ||
      order['deliveryMethod'] !== 'direct'
    ) {
      throw new ForbiddenException('회차 직배송 주문만 배송 사진을 업로드할 수 있습니다.');
    }
    if (input.requesterRole !== 'driver' || order['driverId'] !== input.requesterId) {
      throw new ForbiddenException('담당 기사만 배송 사진을 업로드할 수 있습니다.');
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
