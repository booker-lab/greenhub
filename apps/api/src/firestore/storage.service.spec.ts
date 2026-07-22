import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StorageService } from './storage.service';

type OrderData = Record<string, unknown>;

function makeService(order: OrderData | null = null) {
  let storedMetadata: Record<string, unknown> | null = null;
  const save = jest.fn(async (_content: Buffer, options: { metadata: Record<string, unknown> }) => {
    if (storedMetadata) {
      const error = new Error('생성 조건 불일치') as Error & { code: number };
      error.code = 412;
      throw error;
    }
    storedMetadata = options.metadata;
  });
  const getMetadata = jest.fn(async () => {
    if (!storedMetadata) {
      const error = new Error('객체 없음') as Error & { code: number };
      error.code = 404;
      throw error;
    }
    return [storedMetadata];
  });
  const getSignedUrl = jest.fn().mockResolvedValue(['https://signed.example.invalid/redacted']);
  const deleteFile = jest.fn().mockResolvedValue(undefined);
  const file = jest.fn(() => ({
    save,
    getMetadata,
    getSignedUrl,
    delete: deleteFile,
  }));
  const bucket = { file };
  const app = {
    storage: () => ({
      bucket: () => bucket,
    }),
  };
  const firestore = {
    doc: jest.fn(() => ({
      get: jest.fn().mockResolvedValue({
        exists: order !== null,
        data: () => order ?? undefined,
      }),
    })),
  };
  const service = new StorageService(app as never, firestore as never);

  return {
    deleteFile,
    file,
    firestore,
    getMetadata,
    getSignedUrl,
    getStoredMetadata: () => storedMetadata,
    save,
    service,
  };
}

describe('배송 사진 Storage 계약', () => {
  it('담당 기사가 배송 사진을 서버에서 비공개 경로로 업로드한다', async () => {
    const { file, save, service } = makeService({
      storeId: 'store-safe',
      userId: 'consumer-safe',
      driverId: 'driver-safe',
      schemaVersion: 2,
      roundId: 'round-safe',
      deliveryMethod: 'direct',
      status: 'DELIVERING',
      deliveryPhotoIds: [],
    });
    const content = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

    const result = await service.uploadDeliveryPhoto({
      storeId: 'store-safe',
      orderId: 'order-safe',
      photoId: 'photo-safe',
      requesterId: 'driver-safe',
      requesterRole: 'driver',
      content,
      contentType: 'image/jpeg',
    });

    expect(file).toHaveBeenCalledWith('deliveryPhotos/order-safe/photo-safe.jpg');
    expect(save).toHaveBeenCalledWith(content, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: 'private, max-age=0, no-store',
        metadata: {
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
      validation: 'crc32c',
    });
    expect(result).toEqual({
      orderId: 'order-safe',
      photoId: 'photo-safe',
      path: 'deliveryPhotos/order-safe/photo-safe.jpg',
      created: true,
    });
  });

  it('같은 사진 ID와 같은 JPEG 재시도는 기존 객체를 바꾸지 않고 멱등 성공한다', async () => {
    const context = makeService({
      storeId: 'store-safe',
      driverId: 'driver-safe',
      schemaVersion: 2,
      roundId: 'round-safe',
      deliveryMethod: 'direct',
      status: 'DELIVERING',
      deliveryPhotoIds: [],
    });
    const content = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0xff, 0xd9]);
    const input = {
      storeId: 'store-safe',
      orderId: 'order-safe',
      photoId: 'photo-safe',
      requesterId: 'driver-safe',
      requesterRole: 'driver' as const,
      content,
      contentType: 'image/jpeg' as const,
    };

    const first = await context.service.uploadDeliveryPhoto(input);
    const metadataAfterFirst = context.getStoredMetadata();
    const retried = await context.service.uploadDeliveryPhoto(input);

    expect(first.created).toBe(true);
    expect(retried.created).toBe(false);
    expect(context.getStoredMetadata()).toBe(metadataAfterFirst);
    expect(context.getMetadata).toHaveBeenCalledTimes(1);
  });

  it('같은 사진 ID와 다른 JPEG 재시도는 원본을 유지하고 충돌한다', async () => {
    const context = makeService({
      storeId: 'store-safe',
      driverId: 'driver-safe',
      schemaVersion: 2,
      roundId: 'round-safe',
      deliveryMethod: 'direct',
      status: 'DELIVERING',
      deliveryPhotoIds: [],
    });
    const base = {
      storeId: 'store-safe',
      orderId: 'order-safe',
      photoId: 'photo-safe',
      requesterId: 'driver-safe',
      requesterRole: 'driver' as const,
      contentType: 'image/jpeg' as const,
    };

    await context.service.uploadDeliveryPhoto({
      ...base,
      content: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0xff, 0xd9]),
    });
    const metadataAfterFirst = context.getStoredMetadata();

    await expect(
      context.service.uploadDeliveryPhoto({
        ...base,
        content: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x02, 0xff, 0xd9]),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(context.getStoredMetadata()).toBe(metadataAfterFirst);
  });

  it('배송 사진 크기 제한을 초과하면 주문 조회와 객체 저장 전에 거부한다', async () => {
    const { firestore, save, service } = makeService({
      storeId: 'store-safe',
      driverId: 'driver-safe',
    });

    await expect(
      service.uploadDeliveryPhoto({
        storeId: 'store-safe',
        orderId: 'order-safe',
        photoId: 'photo-safe',
        requesterId: 'driver-safe',
        requesterRole: 'driver',
        content: Buffer.alloc(5 * 1024 * 1024 + 1),
        contentType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(firestore.doc).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('JPEG 시그니처가 없으면 image/jpeg 선언이어도 저장하지 않는다', async () => {
    const { save, service } = makeService({
      storeId: 'store-safe',
      driverId: 'driver-safe',
    });

    await expect(
      service.uploadDeliveryPhoto({
        storeId: 'store-safe',
        orderId: 'order-safe',
        photoId: 'photo-safe',
        requesterId: 'driver-safe',
        requesterRole: 'driver',
        content: Buffer.from('실제 형식은 JPEG가 아님'),
        contentType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('JPEG 시작 시그니처만 위장하고 종료 시그니처가 없으면 저장하지 않는다', async () => {
    const { save, service } = makeService({
      storeId: 'store-safe',
      driverId: 'driver-safe',
    });

    await expect(
      service.uploadDeliveryPhoto({
        storeId: 'store-safe',
        orderId: 'order-safe',
        photoId: 'photo-safe',
        requesterId: 'driver-safe',
        requesterRole: 'driver',
        content: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00, 0x00]),
        contentType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('주문 권한이 없는 요청은 업로드와 서명 URL 발급 전에 거부한다', async () => {
    const { file, service } = makeService({
      storeId: 'store-safe',
      userId: 'consumer-safe',
      driverId: 'driver-safe',
      schemaVersion: 2,
      roundId: 'round-safe',
      deliveryMethod: 'direct',
      status: 'DELIVERING',
      deliveryPhotoIds: ['photo-safe'],
    });

    await expect(
      service.uploadDeliveryPhoto({
        storeId: 'store-safe',
        orderId: 'order-safe',
        photoId: 'photo-safe',
        requesterId: 'other-driver',
        requesterRole: 'driver',
        content: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]),
        contentType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.createDeliveryPhotoReadUrl({
        storeId: 'store-safe',
        orderId: 'order-safe',
        photoId: 'photo-safe',
        requesterId: 'other-consumer',
        requesterRole: 'consumer',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(file).not.toHaveBeenCalled();
  });

  it('권한 있는 주문자에게 15분짜리 읽기 전용 서명 URL을 발급한다', async () => {
    const { getSignedUrl, service } = makeService({
      storeId: 'store-safe',
      userId: 'consumer-safe',
      driverId: 'driver-safe',
      deliveryPhotoIds: ['photo-safe'],
    });
    const now = new Date('2026-07-17T03:00:00.000Z');

    const result = await service.createDeliveryPhotoReadUrl({
      storeId: 'store-safe',
      orderId: 'order-safe',
      photoId: 'photo-safe',
      requesterId: 'consumer-safe',
      requesterRole: 'consumer',
      now,
    });

    expect(getSignedUrl).toHaveBeenCalledWith({
      action: 'read',
      expires: new Date('2026-07-17T03:15:00.000Z'),
      version: 'v4',
    });
    expect(result).toEqual({
      url: 'https://signed.example.invalid/redacted',
      expiresAt: '2026-07-17T03:15:00.000Z',
    });
  });

  it('보관 서비스가 사용할 삭제 어댑터는 전달받은 비공개 경로의 객체만 삭제한다', async () => {
    const { deleteFile, file, service } = makeService();

    await service.deleteObject('deliveryPhotos/order-safe/photo-safe.jpg');

    expect(file).toHaveBeenCalledWith('deliveryPhotos/order-safe/photo-safe.jpg');
    expect(deleteFile).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it('주문이 없거나 다른 스토어 주문이면 객체 접근 전에 숨긴다', async () => {
    const missing = makeService(null);
    const otherStore = makeService({ storeId: 'other-store', userId: 'consumer-safe' });

    await expect(
      missing.service.createDeliveryPhotoReadUrl({
        storeId: 'store-safe',
        orderId: 'order-safe',
        photoId: 'photo-safe',
        requesterId: 'consumer-safe',
        requesterRole: 'consumer',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      otherStore.service.createDeliveryPhotoReadUrl({
        storeId: 'store-safe',
        orderId: 'order-safe',
        photoId: 'photo-safe',
        requesterId: 'consumer-safe',
        requesterRole: 'consumer',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(missing.file).not.toHaveBeenCalled();
    expect(otherStore.file).not.toHaveBeenCalled();
  });

  it('회차 직배송·담당 기사·배송 중 상태가 아니면 업로드하지 않는다', async () => {
    const cases = [
      {
        storeId: 'store-safe',
        driverId: 'driver-safe',
        deliveryMethod: 'direct',
        status: 'DELIVERING',
      },
      {
        storeId: 'store-safe',
        driverId: 'driver-safe',
        schemaVersion: 2,
        roundId: 'round-safe',
        deliveryMethod: 'hub',
        status: 'DELIVERING',
      },
      {
        storeId: 'store-safe',
        driverId: 'driver-safe',
        schemaVersion: 2,
        roundId: 'round-safe',
        deliveryMethod: 'direct',
        status: 'PREPARING',
      },
    ];

    for (const order of cases) {
      const { save, service } = makeService(order);
      await expect(
        service.uploadDeliveryPhoto({
          storeId: 'store-safe',
          orderId: 'order-safe',
          photoId: 'photo-safe',
          requesterId: 'driver-safe',
          requesterRole: 'driver',
          content: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]),
          contentType: 'image/jpeg',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(save).not.toHaveBeenCalled();
    }
  });

  it('주문에 연결되지 않은 사진 ID는 권한이 있어도 서명 URL을 발급하지 않는다', async () => {
    const { file, service } = makeService({
      storeId: 'store-safe',
      userId: 'consumer-safe',
      deliveryPhotoIds: ['photo-other'],
    });

    await expect(
      service.createDeliveryPhotoReadUrl({
        storeId: 'store-safe',
        orderId: 'order-safe',
        photoId: 'photo-safe',
        requesterId: 'consumer-safe',
        requesterRole: 'consumer',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(file).not.toHaveBeenCalled();
  });
});
