import { ConflictException, ForbiddenException } from '@nestjs/common';
import { OrdersLifecycleService } from './orders-lifecycle.service';

type Data = Record<string, unknown>;

function makeFirestore(order: Data) {
  const records = new Map<string, Data>([['orders/order-1', order]]);
  let initialReads = 0;
  let transactionQueue = Promise.resolve();

  const snapshot = (data: Data | null) => ({
    exists: data !== null,
    data: () => data,
  });
  const doc = (path: string) => ({
    path,
    get: jest.fn(async () => {
      if (path === 'orders/order-1' && initialReads < 2) {
        initialReads += 1;
        return snapshot({ ...order });
      }
      return snapshot(records.get(path) ?? null);
    }),
    update: jest.fn(async (data: Data) => {
      records.set(path, { ...(records.get(path) ?? {}), ...data });
    }),
  });

  const firestore = {
    doc,
    runTransaction: jest.fn((callback: (transaction: any) => Promise<unknown>) => {
      const result = transactionQueue.then(async () => {
        const pending = new Map<string, Data>();
        const transaction = {
          get: jest.fn(async (ref: { path: string }) =>
            snapshot(pending.get(ref.path) ?? records.get(ref.path) ?? null),
          ),
          update: jest.fn((ref: { path: string }, data: Data) => {
            pending.set(ref.path, { ...(records.get(ref.path) ?? {}), ...data });
          }),
        };
        const value = await callback(transaction);
        pending.forEach((data, path) => records.set(path, data));
        return value;
      });
      transactionQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }),
    Timestamp: { now: jest.fn(() => new Date('2026-08-23T00:00:00.000Z')) },
  };

  return { firestore, records };
}

function makeService(firestore: unknown) {
  return new OrdersLifecycleService(
    firestore as never,
    { sendToUser: jest.fn().mockResolvedValue(undefined) } as never,
    { processRefundByOrderId: jest.fn() } as never,
    { createSettlement: jest.fn(), cancelSettlement: jest.fn() } as never,
    { releaseReservation: jest.fn() } as never,
    {} as never,
  );
}

describe('driver 주문 선점 경계', () => {
  it('동시에 미배정 주문을 선점해도 한 driver만 성공한다', async () => {
    const { firestore, records } = makeFirestore({
      storeId: 'store-1',
      userId: 'consumer-1',
      status: 'PREPARING',
      deliveryMethod: 'direct',
      driverId: null,
    });
    const service = makeService(firestore);

    const results = await Promise.allSettled([
      service.updateStatus('store-1', 'order-1', 'driver-1', { status: 'DELIVERING' }, 'driver'),
      service.updateStatus('store-1', 'order-1', 'driver-2', { status: 'DELIVERING' }, 'driver'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(records.get('orders/order-1')).toMatchObject({ status: 'DELIVERING' });
    expect(['driver-1', 'driver-2']).toContain(records.get('orders/order-1')?.['driverId']);
    expect(results.find((result) => result.status === 'rejected')?.reason).toBeInstanceOf(
      ConflictException,
    );
  });

  it('다른 driver가 이미 배정된 주문을 바꾸지 못한다', async () => {
    const { firestore } = makeFirestore({
      storeId: 'store-1',
      status: 'PREPARING',
      deliveryMethod: 'direct',
      driverId: 'driver-1',
    });
    const service = makeService(firestore);

    await expect(
      service.updateStatus('store-1', 'order-1', 'driver-2', { status: 'DELIVERING' }, 'driver'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('택배 주문은 driver 선점 대상이 아니다', async () => {
    const { firestore } = makeFirestore({
      storeId: 'store-1',
      status: 'PREPARING',
      deliveryMethod: 'parcel',
      driverId: null,
    });
    const service = makeService(firestore);

    await expect(
      service.updateStatus('store-1', 'order-1', 'driver-1', { status: 'DELIVERING' }, 'driver'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
