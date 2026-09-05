import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type * as admin from 'firebase-admin';
import { FirestoreService } from './firestore.service';

const DELIVERY_PHOTO_URL_TTL_MS = 15 * 60 * 1000;
const DELIVERY_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

type RequesterRole = 'admin' | 'seller' | 'driver' | 'consumer';

interface DeliveryPhotoAccessInput {
  storeId: string;
  orderId: string;
  photoId: string;
  requesterId: string;
  requesterRole: RequesterRole;
}

export type DeliveryPhotoReconciliationState =
  | 'CLEAN'
  | 'ATTACHED'
  | 'CLEANUP_PENDING'
  | 'OUTCOME_UNKNOWN'
  | 'CONFLICT';

export interface DeliveryPhotoReconciliation {
  state: DeliveryPhotoReconciliationState;
  orderId: string;
  photoId: string;
  path: string;
  objectExists: boolean | null;
  attached: boolean | null;
  observedContentSha256?: string;
  orderStatus?: string;
}

@Injectable()
export class StorageService {
  private readonly bucket: ReturnType<admin.storage.Storage['bucket']>;

  constructor(
    @Inject('FIREBASE_APP') app: admin.app.App,
    private readonly firestore: FirestoreService,
  ) {
    this.bucket = app.storage().bucket();
  }

  async uploadDeliveryPhoto(
    input: DeliveryPhotoAccessInput & {
      content: Buffer;
      contentType: 'image/jpeg';
    },
  ): Promise<{ orderId: string; photoId: string; path: string; created: boolean }> {
    this.assertJpegContent(input.content);
    const order = await this.getOrder(input);
    await this.assertAccess(input, order, 'upload');
    const path = this.deliveryPhotoPath(input.orderId, input.photoId);
    const contentSha256 = createHash('sha256').update(input.content).digest('hex');
    const file = this.bucket.file(path);

    try {
      await file.save(input.content, {
        resumable: false,
        validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: input.contentType,
          cacheControl: 'private, max-age=0, no-store',
          metadata: { contentSha256 },
        },
      });
    } catch (error) {
      if (!this.isPreconditionFailed(error)) throw error;
      const [metadata] = await file.getMetadata();
      if (metadata.metadata?.['contentSha256'] !== contentSha256) {
        throw new ConflictException(
          '같은 업로드 요청 식별자에 다른 배송 사진을 사용할 수 없습니다.',
        );
      }
      return { orderId: input.orderId, photoId: input.photoId, path, created: false };
    }

    return { orderId: input.orderId, photoId: input.photoId, path, created: true };
  }

  async createDeliveryPhotoReadUrl(
    input: DeliveryPhotoAccessInput & { now?: Date },
  ): Promise<{ url: string; expiresAt: string }> {
    const order = await this.getOrder(input);
    const photoIds = this.readPhotoIds(order['deliveryPhotoIds']);
    if (!photoIds.includes(input.photoId)) {
      throw new NotFoundException('연결된 배송 사진을 찾을 수 없습니다.');
    }
    await this.assertAccess(input, order, 'read');
    const expiresAt = new Date((input.now ?? new Date()).getTime() + DELIVERY_PHOTO_URL_TTL_MS);
    const [url] = await this.bucket
      .file(this.deliveryPhotoPath(input.orderId, input.photoId))
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: expiresAt,
      });

    return { url, expiresAt: expiresAt.toISOString() };
  }

  async reconcileDeliveryPhoto(input: {
    storeId: string;
    orderId: string;
    photoId: string;
    contentSha256: string;
  }): Promise<DeliveryPhotoReconciliation> {
    const path = this.deliveryPhotoPath(input.orderId, input.photoId);
    const file = this.bucket.file(path);
    let metadata: { metadata?: Record<string, string> } | undefined;

    try {
      const metadataResponse = await file.getMetadata();
      metadata = metadataResponse[0] as { metadata?: Record<string, string> };
    } catch (error) {
      const order = await this.tryGetOrder(input);
      if (order === undefined) {
        return {
          state: 'OUTCOME_UNKNOWN',
          orderId: input.orderId,
          photoId: input.photoId,
          path,
          objectExists: null,
          attached: null,
        };
      }
      const attached = order
        ? this.readPhotoIds(order['deliveryPhotoIds']).includes(input.photoId)
        : null;
      const orderStatus = this.readOrderStatus(order);
      if (!this.isNotFound(error)) {
        return {
          state: 'OUTCOME_UNKNOWN',
          orderId: input.orderId,
          photoId: input.photoId,
          path,
          objectExists: null,
          attached,
          orderStatus,
        };
      }
      return {
        state: attached ? 'CONFLICT' : 'CLEAN',
        orderId: input.orderId,
        photoId: input.photoId,
        path,
        objectExists: false,
        attached,
        orderStatus,
      };
    }

    const observedContentSha256 = metadata?.metadata?.['contentSha256'];
    const order = await this.tryGetOrder(input);
    if (!order) {
      return {
        state: 'OUTCOME_UNKNOWN',
        orderId: input.orderId,
        photoId: input.photoId,
        path,
        objectExists: true,
        attached: null,
        observedContentSha256,
      };
    }

    const photoIds = this.readPhotoIds(order['deliveryPhotoIds']);
    const attached = photoIds.includes(input.photoId);
    const orderStatus = this.readOrderStatus(order);
    if (observedContentSha256 !== input.contentSha256) {
      return {
        state: 'CONFLICT',
        orderId: input.orderId,
        photoId: input.photoId,
        path,
        objectExists: true,
        attached,
        observedContentSha256,
        orderStatus,
      };
    }
    if (attached) {
      return {
        state: 'ATTACHED',
        orderId: input.orderId,
        photoId: input.photoId,
        path,
        objectExists: true,
        attached: true,
        observedContentSha256,
        orderStatus,
      };
    }
    if (photoIds.length > 0) {
      return {
        state: 'CONFLICT',
        orderId: input.orderId,
        photoId: input.photoId,
        path,
        objectExists: true,
        attached: false,
        observedContentSha256,
        orderStatus,
      };
    }
    return {
      state: 'CLEANUP_PENDING',
      orderId: input.orderId,
      photoId: input.photoId,
      path,
      objectExists: true,
      attached: false,
      observedContentSha256,
      orderStatus,
    };
  }

  async deleteObject(path: string): Promise<void> {
    this.assertDeliveryPhotoPath(path);
    await this.bucket.file(path).delete({ ignoreNotFound: true });
  }

  private async getOrder(input: Pick<DeliveryPhotoAccessInput, 'storeId' | 'orderId'>) {
    this.assertSafeId(input.storeId, 'storeId');
    this.assertSafeId(input.orderId, 'orderId');
    const snapshot = await this.firestore.doc(`orders/${input.orderId}`).get();
    if (!snapshot.exists || snapshot.data()?.storeId !== input.storeId) {
      throw new NotFoundException('주문을 찾을 수 없습니다.');
    }
    return snapshot.data() as Record<string, unknown>;
  }

  private async tryGetOrder(input: Pick<DeliveryPhotoAccessInput, 'storeId' | 'orderId'>) {
    this.assertSafeId(input.storeId, 'storeId');
    this.assertSafeId(input.orderId, 'orderId');
    try {
      const snapshot = await this.firestore.doc(`orders/${input.orderId}`).get();
      if (!snapshot.exists || snapshot.data()?.['storeId'] !== input.storeId) return null;
      return snapshot.data() as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  private async assertAccess(
    input: DeliveryPhotoAccessInput,
    order: Record<string, unknown>,
    action: 'upload' | 'read',
  ): Promise<void> {
    if (action === 'upload') {
      this.assertRoundDirectUpload(input, order);
      return;
    }
    if (input.requesterRole === 'admin') return;
    if (input.requesterRole === 'seller') {
      const store = await this.firestore.doc(`stores/${input.storeId}`).get();
      if (store.exists && store.data()?.ownerId === input.requesterId) return;
    }
    if (input.requesterRole === 'driver' && order.driverId === input.requesterId) return;
    if (
      action === 'read' &&
      input.requesterRole === 'consumer' &&
      order.userId === input.requesterId
    ) {
      return;
    }
    throw new ForbiddenException('배송 사진에 접근할 권한이 없습니다.');
  }

  private deliveryPhotoPath(orderId: string, photoId: string): string {
    this.assertSafeId(photoId, 'photoId');
    return `deliveryPhotos/${orderId}/${photoId}.jpg`;
  }

  private assertDeliveryPhotoPath(path: string): void {
    const match = /^deliveryPhotos\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\.jpg$/.exec(path);
    if (!match) {
      throw new BadRequestException('유효하지 않은 배송 사진 경로입니다.');
    }
  }

  private assertSafeId(value: string, field: string): void {
    if (value.length > 128 || !SAFE_ID_PATTERN.test(value)) {
      throw new BadRequestException(`${field} 형식이 올바르지 않습니다.`);
    }
  }

  private assertJpegContent(content: Buffer): void {
    if (content.length === 0 || content.length > DELIVERY_PHOTO_MAX_BYTES) {
      throw new BadRequestException('배송 사진 크기는 5MB 이하여야 합니다.');
    }
    const hasJpegSignature =
      content.length >= 4 &&
      content[0] === 0xff &&
      content[1] === 0xd8 &&
      content[2] === 0xff &&
      content[content.length - 2] === 0xff &&
      content[content.length - 1] === 0xd9;
    if (!hasJpegSignature) {
      throw new BadRequestException('실제 JPEG 형식의 배송 사진만 업로드할 수 있습니다.');
    }
  }

  private assertRoundDirectUpload(
    input: DeliveryPhotoAccessInput,
    order: Record<string, unknown>,
  ): void {
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
    const photoIds = this.readPhotoIds(order['deliveryPhotoIds']);
    if (photoIds.length > 0 && !photoIds.includes(input.photoId)) {
      throw new ConflictException('배송 사진이 이미 연결되어 있습니다.');
    }
    const isRetry = order['status'] === 'DELIVERED' && photoIds.includes(input.photoId);
    if (order['status'] !== 'DELIVERING' && !isRetry) {
      throw new ForbiddenException('배송 중인 주문에만 사진을 업로드할 수 있습니다.');
    }
  }

  private readPhotoIds(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((photoId): photoId is string => typeof photoId === 'string')
      : [];
  }

  private isPreconditionFailed(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 412 || code === '412';
  }

  private isNotFound(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 404 || code === '404' || code === 'storage/object-not-found';
  }

  private readOrderStatus(order: Record<string, unknown> | null | undefined): string | undefined {
    return typeof order?.['status'] === 'string' ? order['status'] : undefined;
  }
}
