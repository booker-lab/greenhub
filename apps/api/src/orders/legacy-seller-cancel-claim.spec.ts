// legacy 판매자 취소는 환불 전에 cancellation claim을 트랜잭션으로 잡는다. claim이 살아 있는
// 동안 기사 배송 시작 등 다른 상태 전이는 거절되고, 환불이 실패하면 주문 상태는 그대로 두고
// REFUND_FAILED를 남겨 재시도·운영 확인 대상으로 만든다.

import { ConflictException } from '@nestjs/common';
import { OrdersLifecycleService } from './orders-lifecycle.service';

type Data = Record<string, any>;

function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Data).map(([key, item]) => [key, clone(item)]),
    ) as T;
  }
  return value;
}

function makeFirestore(initial: Record<string, Data>) {
  const records = new Map<string, Data>(
    Object.entries(initial).map(([path, data]) => [path, clone(data)]),
  );
  const getHooks = new Map<string, () => void>();
  let transactionQueue = Promise.resolve();

  function snapshot(path: string, source: Map<string, Data>) {
    const data = source.get(path);
    return {
      exists: data !== undefined,
      id: path.split('/').at(-1),
      data: () => (data === undefined ? undefined : clone(data)),
    };
  }

  const firestore = {
    doc: (path: string) => ({
      path,
      id: path.split('/').at(-1),
      get: jest.fn(async () => {
        const result = snapshot(path, records);
        getHooks.get(path)?.();
        return result;
      }),
    }),
    runTransaction: jest.fn((callback: (transaction: any) => Promise<unknown>) => {
      const result = transactionQueue.then(async () => {
        const staged = new Map<string, Data>(
          Array.from(records.entries()).map(([path, data]) => [path, clone(data)]),
        );
        const transaction = {
          get: jest.fn(async (ref: { path: string }) => snapshot(ref.path, staged)),
          set: jest.fn((ref: { path: string }, data: Data) => {
            staged.set(ref.path, { ...(staged.get(ref.path) ?? {}), ...clone(data) });
          }),
          update: jest.fn((ref: { path: string }, data: Data) => {
            const current = staged.get(ref.path);
            if (!current) throw new Error(`존재하지 않는 문서입니다: ${ref.path}`);
            staged.set(ref.path, { ...current, ...clone(data) });
          }),
        };
        const value = await callback(transaction);
        records.clear();
        for (const [path, data] of staged) records.set(path, data);
        return value;
      });
      transactionQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }),
    Timestamp: {
      now: jest.fn(() => new Date('2026-10-09T00:00:00.000Z')),
      fromDate: jest.fn((date: Date) => new Date(date.getTime())),
    },
    FieldValue: {
      increment: jest.fn((value: number) => ({ __op: 'increment', value })),
    },
  };

  return {
    firestore,
    records,
    read: (path: string) => clone(records.get(path)),
    onGet: (path: string, hook: () => void) => getHooks.set(path, hook),
  };
}

function makeContext(orderOverrides: Data = {}) {
  const memory = makeFirestore({
    'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
    'orders/order-1': {
      id: 'order-1',
      storeId: 'store-1',
      userId: 'consumer-1',
      productId: 'product-1',
      quantity: 1,
      status: 'PREPARING',
      saleType: 'normal',
      deliveryMethod: 'parcel',
      totalAmount: 30000,
      ...orderOverrides,
    },
  });
  const payments = { processRefundByOrderId: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    sendToGroupParticipants: jest.fn().mockResolvedValue(undefined),
  };
  const settlements = {
    createSettlement: jest.fn().mockResolvedValue(undefined),
    cancelSettlement: jest.fn().mockResolvedValue(undefined),
  };
  const driverScope = {
    assertMutationEligibility: jest.fn().mockResolvedValue(undefined),
    assertMutationEligibilityInTransaction: jest.fn().mockResolvedValue(undefined),
    assertFirstClaimEligibilityInTransaction: jest.fn().mockResolvedValue(undefined),
  };
  const lifecycle = new OrdersLifecycleService(
    memory.firestore as never,
    notifications as never,
    payments as never,
    settlements as never,
    {} as never,
    { updateStatus: jest.fn(), cancelByConsumer: jest.fn() } as never,
    driverScope as never,
  );
  const sellerCancel = () =>
    lifecycle.updateStatus(
      'store-1',
      'order-1',
      'seller-1',
      { status: 'CANCELLED', reason: '재고 부족' } as never,
      'seller',
    );
  const driverStart = () =>
    lifecycle.updateStatus(
      'store-1',
      'order-1',
      'driver-1',
      { status: 'DELIVERING' } as never,
      'driver',
    );
  return { memory, payments, notifications, settlements, lifecycle, sellerCancel, driverStart };
}

describe('legacy 판매자 취소 환불 전 claim', () => {
  it('환불 시점에는 REFUNDING claim이 잡혀 있고, 완료 뒤 CANCELLED·COMPLETED로 닫힌다', async () => {
    const context = makeContext();
    context.payments.processRefundByOrderId.mockImplementation(async () => {
      expect(context.memory.read('orders/order-1')).toMatchObject({
        status: 'PREPARING',
        cancellation: { status: 'REFUNDING', reason: '재고 부족' },
      });
    });

    await expect(context.sellerCancel()).resolves.toEqual({
      orderId: 'order-1',
      status: 'CANCELLED',
    });

    expect(context.payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancelReason: '재고 부족',
      cancellation: { status: 'COMPLETED', reason: '재고 부족' },
    });
    expect(context.settlements.cancelSettlement).toHaveBeenCalledWith('order-1');
  });

  it('환불 중 기사 배송 시작은 거절되고 주문은 취소로 끝난다', async () => {
    const context = makeContext();
    let driverResult: PromiseSettledResult<unknown> | null = null;
    context.payments.processRefundByOrderId.mockImplementation(async () => {
      [driverResult] = await Promise.allSettled([context.driverStart()]);
    });

    await expect(context.sellerCancel()).resolves.toMatchObject({ status: 'CANCELLED' });

    expect(driverResult).toMatchObject({ status: 'rejected' });
    expect((driverResult as unknown as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictException,
    );
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'CANCELLED' });
    expect(context.memory.read('orders/order-1')).not.toHaveProperty('driverId');
    expect(context.settlements.createSettlement).not.toHaveBeenCalled();
  });

  it('claim 전에 주문 상태가 바뀌었으면 환불하지 않고 충돌로 끝난다', async () => {
    const context = makeContext();
    // 최초 조회 뒤(판매자 권한 확인 시점) 기사가 먼저 배송을 시작한 상황
    context.memory.onGet('stores/store-1', () => {
      context.memory.records.set('orders/order-1', {
        ...(context.memory.records.get('orders/order-1') as Data),
        status: 'DELIVERING',
        driverId: 'driver-1',
      });
    });

    await expect(context.sellerCancel()).rejects.toBeInstanceOf(ConflictException);

    expect(context.payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'DELIVERING' });
    expect(context.memory.read('orders/order-1')).not.toHaveProperty('cancellation');
  });

  it('진행 중인 다른 취소 claim이 있으면 환불하지 않는다', async () => {
    const context = makeContext({
      cancellation: {
        status: 'REFUNDING',
        refundClaim: { token: 'admin-claim', expiresAt: Date.now() + 60_000 },
      },
    });

    await expect(context.sellerCancel()).rejects.toBeInstanceOf(ConflictException);
    expect(context.payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'PREPARING',
      cancellation: { refundClaim: { token: 'admin-claim' } },
    });
  });

  it('환불 실패 시 상태는 유지하고 REFUND_FAILED를 남기며, 그동안 배송 시작을 막고 재시도는 허용한다', async () => {
    const context = makeContext();
    context.payments.processRefundByOrderId.mockRejectedValueOnce(new Error('refund down'));

    await expect(context.sellerCancel()).rejects.toThrow('refund down');
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'PREPARING',
      cancellation: { status: 'REFUND_FAILED' },
    });

    await expect(context.driverStart()).rejects.toBeInstanceOf(ConflictException);
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'PREPARING' });

    await expect(context.sellerCancel()).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(context.payments.processRefundByOrderId).toHaveBeenCalledTimes(2);
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
  });

  it('취소 claim이 없는 주문의 배송 시작은 기존대로 진행된다', async () => {
    const context = makeContext();

    await expect(context.driverStart()).resolves.toMatchObject({ status: 'DELIVERING' });
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'DELIVERING',
      driverId: 'driver-1',
    });
  });
});
