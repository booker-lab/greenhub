import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DriverOrderScopeService } from './driver-order-scope.service';
import { OrdersLifecycleService } from './orders-lifecycle.service';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';

type Data = Record<string, unknown>;

function makeFirestore(order: Data, salesMode = 'legacy') {
  const records = new Map<string, Data>([['orders/order-1', order]]);
  records.set('stores/store-1', { id: 'store-1', salesMode });
  if (typeof order['roundId'] === 'string') {
    records.set(`saleRounds/${order['roundId']}`, {
      id: order['roundId'],
      storeId: 'store-1',
      counters: { heldOrderCount: 0 },
    });
  }
  records.set('users/driver-1', {
    id: 'driver-1',
    role: 'driver',
    driverApproved: true,
  });
  records.set('users/driver-2', {
    id: 'driver-2',
    role: 'driver',
    driverApproved: true,
  });
  let initialReads = 0;
  let transactionQueue = Promise.resolve();
  let orderWrites = 0;

  const snapshot = (data: Data | null) => ({
    exists: data !== null,
    data: () => data,
  });
  const doc = (path: string) => ({
    path,
    get: jest.fn(() => {
      if (path === 'orders/order-1' && initialReads < 2) {
        initialReads += 1;
        return Promise.resolve(snapshot({ ...order }));
      }
      return Promise.resolve(snapshot(records.get(path) ?? null));
    }),
    update: jest.fn((data: Data) => {
      if (path === 'orders/order-1') orderWrites += 1;
      records.set(path, { ...(records.get(path) ?? {}), ...data });
      return Promise.resolve();
    }),
  });

  const firestore = {
    doc,
    runTransaction: jest.fn((callback: (transaction: any) => Promise<unknown>) => {
      const result = transactionQueue.then(async () => {
        const pending = new Map<string, Data>();
        const transaction = {
          get: jest.fn((ref: { path: string }) =>
            Promise.resolve(snapshot(pending.get(ref.path) ?? records.get(ref.path) ?? null)),
          ),
          update: jest.fn((ref: { path: string }, data: Data) => {
            if (ref.path === 'orders/order-1') orderWrites += 1;
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

  return { firestore, orderWrites: () => orderWrites, records };
}

function makeService(firestore: unknown) {
  const driverScope = new DriverOrderScopeService(firestore as never);
  const notifications = {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    sendToGroupParticipants: jest.fn().mockResolvedValue(undefined),
  };
  const payments = {
    processRefundByOrderId: jest.fn().mockResolvedValue(undefined),
    refundOrderChargesByOrderId: jest.fn().mockResolvedValue(undefined),
  };
  const settlements = {
    createSettlement: jest.fn().mockResolvedValue(undefined),
    cancelSettlement: jest.fn().mockResolvedValue(undefined),
  };
  const capacity = {
    releaseReservation: jest.fn().mockResolvedValue(undefined),
    releaseReservationInTransaction: jest.fn().mockResolvedValue(undefined),
  };
  const roundLifecycle = new RoundOrderLifecycleService(
    firestore as never,
    payments as never,
    settlements as never,
    capacity as never,
    driverScope,
  );
  return new OrdersLifecycleService(
    firestore as never,
    notifications as never,
    payments as never,
    settlements as never,
    capacity as never,
    roundLifecycle,
    driverScope,
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

  it('round_direct first claim 경쟁에서는 transaction authority를 통과한 한 요청만 승리한다', async () => {
    const { firestore, orderWrites, records } = makeFirestore(
      {
        storeId: 'store-1',
        schemaVersion: 2,
        roundId: 'round-1',
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: null,
      },
      'round_direct',
    );
    const service = makeService(firestore);

    const results = await Promise.allSettled([
      service.updateStatus('store-1', 'order-1', 'driver-1', { status: 'DELIVERING' }, 'driver'),
      service.updateStatus('store-1', 'order-1', 'driver-2', { status: 'DELIVERING' }, 'driver'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')?.reason).toBeInstanceOf(
      ConflictException,
    );
    expect(records.get('orders/order-1')).toMatchObject({
      status: 'DELIVERING',
      driverId: expect.stringMatching(/^driver-[12]$/),
    });
    expect(orderWrites()).toBe(1);
  });
});
