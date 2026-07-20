import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';

function makeService(order: Record<string, unknown>) {
  const update = jest.fn();
  const transaction = {
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => order,
    }),
    update,
  };
  const firestore = {
    doc: jest.fn((path: string) => ({ path })),
    runTransaction: jest.fn((callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
    Timestamp: {
      now: jest.fn(() => new Date('2026-07-18T03:00:00.000Z')),
      fromDate: jest.fn((value: Date) => value),
    },
  };
  const service = new RoundOrderLifecycleService(
    firestore as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, update };
}

const baseOrder = {
  id: 'order-safe',
  storeId: 'store-safe',
  roundId: 'round-safe',
  schemaVersion: 2,
  deliveryMethod: 'direct',
  driverId: 'driver-safe',
  status: 'DELIVERING',
};

describe('회차 직배송 완료 사진 게이트', () => {
  it('연결된 비공개 사진 ID가 없으면 직접배송 완료 전환을 거부한다', async () => {
    const { service, update } = makeService({ ...baseOrder, deliveryPhotoIds: [] });

    await expect(
      service.updateStatus({
        storeId: 'store-safe',
        orderId: 'order-safe',
        expectedStatus: 'DELIVERING',
        dto: { status: 'DELIVERED' },
        requesterId: 'driver-safe',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('연결 사진이 있어도 공개 URL을 회차 주문에 저장하려는 완료 요청은 거부한다', async () => {
    const { service, update } = makeService({
      ...baseOrder,
      deliveryPhotoIds: ['photo-safe'],
    });

    await expect(
      service.updateStatus({
        storeId: 'store-safe',
        orderId: 'order-safe',
        expectedStatus: 'DELIVERING',
        dto: {
          status: 'DELIVERED',
          photoUrl: 'https://public.example.invalid/photo.jpg',
        },
        requesterId: 'driver-safe',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('연결된 사진 ID가 있는 주문만 서버 트랜잭션에서 완료한다', async () => {
    const { service, update } = makeService({
      ...baseOrder,
      deliveryPhotoIds: ['photo-safe'],
    });

    await expect(
      service.updateStatus({
        storeId: 'store-safe',
        orderId: 'order-safe',
        expectedStatus: 'DELIVERING',
        dto: { status: 'DELIVERED' },
        requesterId: 'driver-safe',
      }),
    ).resolves.toEqual({ orderId: 'order-safe', status: 'DELIVERED' });
    expect(update).toHaveBeenCalledWith(
      { path: 'orders/order-safe' },
      expect.objectContaining({ status: 'DELIVERED' }),
    );
  });
});
