import {
  BadRequestException,
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
  ): Promise<{ orderId: string; photoId: string; path: string }> {
    this.assertJpegContent(input.content);
    const order = await this.getOrder(input);
    await this.assertAccess(input, order, 'upload');
    const path = this.deliveryPhotoPath(input.orderId, input.photoId);

    await this.bucket.file(path).save(input.content, {
      resumable: false,
      validation: 'crc32c',
      metadata: {
        contentType: input.contentType,
        cacheControl: 'private, max-age=0, no-store',
      },
    });

    return { orderId: input.orderId, photoId: input.photoId, path };
  }

  async createDeliveryPhotoReadUrl(
    input: DeliveryPhotoAccessInput & { now?: Date },
  ): Promise<{ url: string; expiresAt: string }> {
    const order = await this.getOrder(input);
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

  private async assertAccess(
    input: DeliveryPhotoAccessInput,
    order: Record<string, unknown>,
    action: 'upload' | 'read',
  ): Promise<void> {
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
    if (!SAFE_ID_PATTERN.test(value)) {
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
}
