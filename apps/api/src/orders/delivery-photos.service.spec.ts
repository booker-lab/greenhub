import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DeliveryPhotosService } from './delivery-photos.service';

type Data = Record<string, any>;

function makeService(initialOrder: Data) {
  let order = { ...initialOrder };
  const update = jest.fn((_: unknown, changes: Data) => {
    order = { ...order, ...changes };
  });
  const transaction = {
    get: jest.fn(async () => ({
      exists: true,
      data: () => ({ ...order }),
    })),
    update,
  };
  const firestore = {
    doc: jest.fn((path: string) => ({ path })),
    runTransaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
    Timestamp: {
      now: jest.fn(() => ({
        toDate: () => new Date('2026-07-18T03:00:00.000Z'),
      })),
    },
  };
  const storage = {
    uploadDeliveryPhoto: jest.fn(async (input: Data) => ({
      orderId: input.orderId,
      photoId: input.photoId,
      path: `deliveryPhotos/${input.orderId}/${input.photoId}.jpg`,
    })),
    createDeliveryPhotoReadUrl: jest.fn(async () => ({
      url: 'https://signed.example.invalid/photo',
      expiresAt: '2026-07-18T03:15:00.000Z',
    })),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  const retention = {
    saveRecord: jest.fn().mockResolvedValue({ id: '기록' }),
  };
  const lifecycle = {
    updateStatus: jest.fn(async () => {
      order = { ...order, status: 'DELIVERED' };
      return {
        orderId: initialOrder.id,
        status: 'DELIVERED',
      };
    }),
  };
  const service = new DeliveryPhotosService(
    firestore as never,
    storage as never,
    retention as never,
    lifecycle as never,
  );

  return {
    firestore,
    getOrder: () => order,
    lifecycle,
    retention,
    service,
    storage,
    transaction,
  };
}

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);

function uploadInput(overrides: Data = {}) {
  return {
    storeId: 'store-safe',
    orderId: 'order-safe',
    requesterId: 'driver-safe',
    requesterRole: 'driver' as const,
    idempotencyKey: 'request-safe',
    content: jpeg,
    contentType: 'image/jpeg',
    ...overrides,
  };
}

describe('회차 직배송 사진 API 서비스 계약', () => {
  it('업로드 성공 뒤 사진 ID와 보관 기록을 연결한 다음 배송 완료를 요청한다', async () => {
    const context = makeService({
      id: 'order-safe',
      storeId: 'store-safe',
      userId: 'consumer-safe',
      driverId: 'driver-safe',
      schemaVersion: 2,
      roundId: 'round-safe',
      deliveryMethod: 'direct',
      status: 'DELIVERING',
      deliveryPhotoIds: [],
    });

    const result = await context.service.uploadAndComplete(uploadInput());

    expect(context.storage.uploadDeliveryPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-safe',
        requesterId: 'driver-safe',
        requesterRole: 'driver',
        content: jpeg,
        contentType: 'image/jpeg',
      }),
    );
    const photoId = context.storage.uploadDeliveryPhoto.mock.calls[0][0].photoId;
    expect(context.getOrder().deliveryPhotoIds).toEqual([photoId]);
    expect(context.retention.saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `order-safe:${photoId}`,
        purpose: 'DELIVERY_PHOTO',
        storagePath: `deliveryPhotos/order-safe/${photoId}.jpg`,
        metadata: { orderId: 'order-safe', photoId },
        transaction: context.transaction,
      }),
    );
    expect(context.lifecycle.updateStatus).toHaveBeenCalledWith(
      'store-safe',
      'order-safe',
      'driver-safe',
      { status: 'DELIVERED' },
      'driver',
    );
    expect(result).toEqual({ orderId: 'order-safe', photoId, status: 'DELIVERED' });
  });

  it('주문 연결이 실패하면 업로드 객체를 정리하고 완료 상태를 호출하지 않는다', async () => {
    const context = makeService({
      id: 'order-safe',
      storeId: 'store-safe',
      driverId: 'driver-safe',
      schemaVersion: 2,
      roundId: 'round-safe',
      deliveryMethod: 'direct',
      status: 'DELIVERING',
      deliveryPhotoIds: [],
    });
    context.firestore.runTransaction.mockRejectedValueOnce(new Error('주문 연결 실패'));

    await expect(context.service.uploadAndComplete(uploadInput())).rejects.toThrow(
      '주문 연결 실패',
    );

    const photoId = context.storage.uploadDeliveryPhoto.mock.calls[0][0].photoId;
    expect(context.storage.deleteObject).toHaveBeenCalledWith(
      `deliveryPhotos/order-safe/${photoId}.jpg`,
    );
    expect(context.lifecycle.updateStatus).not.toHaveBeenCalled();
  });

  it('사진 연결 뒤 완료 전환이 실패하면 사진을 유지하고 성공 상태를 추정하지 않는다', async () => {
    const context = makeService({
      id: 'order-safe',
      storeId: 'store-safe',
      driverId: 'driver-safe',
      schemaVersion: 2,
      roundId: 'round-safe',
      deliveryMethod: 'direct',
      status: 'DELIVERING',
      deliveryPhotoIds: [],
    });
    context.lifecycle.updateStatus.mockRejectedValueOnce(new ConflictException('상태 변경'));

    await expect(context.service.uploadAndComplete(uploadInput())).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(context.getOrder().status).toBe('DELIVERING');
    expect(context.getOrder().deliveryPhotoIds).toHaveLength(1);
    expect(context.storage.deleteObject).not.toHaveBeenCalled();
  });

  it('같은 요청 재시도는 같은 사진 ID를 유지하고 중복 연결하지 않는다', async () => {
    const context = makeService({
      id: 'order-safe',
      storeId: 'store-safe',
      userId: 'consumer-safe',
      driverId: 'driver-safe',
      schemaVersion: 2,
      roundId: 'round-safe',
      deliveryMethod: 'direct',
      status: 'DELIVERING',
      deliveryPhotoIds: [],
    });

    const first = await context.service.uploadAndComplete(uploadInput());
    const second = await context.service.uploadAndComplete(uploadInput());

    expect(second.photoId).toBe(first.photoId);
    expect(context.getOrder().deliveryPhotoIds).toEqual([first.photoId]);
    expect(context.lifecycle.updateStatus).toHaveBeenCalledTimes(1);
  });

  it('다른 사진이 이미 연결된 주문에는 중복 사진을 연결하지 않는다', async () => {
    const context = makeService({
      id: 'order-safe',
      storeId: 'store-safe',
      driverId: 'driver-safe',
      schemaVersion: 2,
      roundId: 'round-safe',
      deliveryMethod: 'direct',
      status: 'DELIVERING',
      deliveryPhotoIds: ['photo-existing'],
    });

    await expect(context.service.uploadAndComplete(uploadInput())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(context.lifecycle.updateStatus).not.toHaveBeenCalled();
  });

  it('담당 기사 외 업로드와 회차 직배송이 아닌 주문을 닫힌 방식으로 거부한다', async () => {
    const otherDriver = makeService({
      id: 'order-safe',
      storeId: 'store-safe',
      driverId: 'driver-safe',
      schemaVersion: 2,
      roundId: 'round-safe',
      deliveryMethod: 'direct',
      status: 'DELIVERING',
    });
    otherDriver.storage.uploadDeliveryPhoto.mockRejectedValueOnce(new ForbiddenException());

    await expect(
      otherDriver.service.uploadAndComplete(uploadInput({ requesterId: 'other-driver' })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const legacy = makeService({
      id: 'order-safe',
      storeId: 'store-safe',
      driverId: 'driver-safe',
      deliveryMethod: 'direct',
      status: 'DELIVERING',
    });
    legacy.storage.uploadDeliveryPhoto.mockRejectedValueOnce(new BadRequestException());
    await expect(legacy.service.uploadAndComplete(uploadInput())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('권한 검사를 통과한 연결 사진에 대해서만 15분 서명 URL을 반환한다', async () => {
    const context = makeService({
      id: 'order-safe',
      storeId: 'store-safe',
      userId: 'consumer-safe',
      driverId: 'driver-safe',
      schemaVersion: 2,
      roundId: 'round-safe',
      deliveryMethod: 'direct',
      status: 'DELIVERED',
      deliveryPhotoIds: ['photo-safe'],
    });

    const result = await context.service.createReadUrl({
      storeId: 'store-safe',
      orderId: 'order-safe',
      photoId: 'photo-safe',
      requesterId: 'consumer-safe',
      requesterRole: 'consumer',
    });

    expect(context.storage.createDeliveryPhotoReadUrl).toHaveBeenCalledWith({
      storeId: 'store-safe',
      orderId: 'order-safe',
      photoId: 'photo-safe',
      requesterId: 'consumer-safe',
      requesterRole: 'consumer',
    });
    expect(result).toEqual({
      orderId: 'order-safe',
      photoId: 'photo-safe',
      url: 'https://signed.example.invalid/photo',
      expiresAt: '2026-07-18T03:15:00.000Z',
    });
  });
});
