import { ConflictException, ForbiddenException } from '@nestjs/common';
import { OrdersLifecycleService } from './orders-lifecycle.service';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';

type Data = Record<string, any>;
type Write = { operation: 'set' | 'update'; path: string; data: Data };

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

function applyPatch(current: Data, patch: Data): Data {
  const next = clone(current);
  for (const [path, rawValue] of Object.entries(patch)) {
    const keys = path.split('.');
    const leaf = keys.pop()!;
    let target = next;
    for (const key of keys) {
      target[key] = clone(target[key] ?? {});
      target = target[key];
    }
    const value = rawValue as { __op?: string; value?: number };
    target[leaf] =
      value?.__op === 'increment'
        ? Number(target[leaf] ?? 0) + Number(value.value ?? 0)
        : clone(rawValue);
  }
  return next;
}

function makeFirestore(initial: Record<string, Data>) {
  const records = new Map<string, Data>(
    Object.entries(initial).map(([path, data]) => [path, clone(data)]),
  );
  const writes: Write[] = [];
  const directWrites: Write[] = [];
  let tick = 0;
  let transactionQueue = Promise.resolve();

  function snapshot(path: string, source: Map<string, Data>) {
    const data = source.get(path);
    return {
      exists: data !== undefined,
      id: path.split('/').at(-1),
      data: () => (data === undefined ? undefined : clone(data)),
    };
  }

  function doc(path: string) {
    return {
      path,
      id: path.split('/').at(-1),
      get: jest.fn(async () => snapshot(path, records)),
      set: jest.fn(async (data: Data) => {
        directWrites.push({ operation: 'set', path, data: clone(data) });
        records.set(path, clone(data));
      }),
      update: jest.fn(async (data: Data) => {
        const current = records.get(path);
        if (!current) throw new Error(`존재하지 않는 문서입니다: ${path}`);
        directWrites.push({ operation: 'update', path, data: clone(data) });
        records.set(path, applyPatch(current, data));
      }),
    };
  }

  const firestore = {
    doc,
    runTransaction: jest.fn((callback: (transaction: any) => Promise<unknown>) => {
      const result = transactionQueue.then(async () => {
        const staged = new Map<string, Data>(
          Array.from(records.entries()).map(([path, data]) => [path, clone(data)]),
        );
        const pendingWrites: Write[] = [];
        const transaction = {
          get: jest.fn(async (ref: { path: string }) => snapshot(ref.path, staged)),
          set: jest.fn((ref: { path: string }, data: Data) => {
            pendingWrites.push({ operation: 'set', path: ref.path, data: clone(data) });
            staged.set(ref.path, clone(data));
          }),
          update: jest.fn((ref: { path: string }, data: Data) => {
            const current = staged.get(ref.path);
            if (!current) throw new Error(`존재하지 않는 문서입니다: ${ref.path}`);
            pendingWrites.push({ operation: 'update', path: ref.path, data: clone(data) });
            staged.set(ref.path, applyPatch(current, data));
          }),
        };
        const value = await callback(transaction);
        records.clear();
        for (const [path, data] of staged) records.set(path, data);
        writes.push(...pendingWrites);
        return value;
      });
      transactionQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }),
    Timestamp: {
      now: jest.fn(() => new Date(Date.UTC(2026, 7, 27, 0, 0, tick++))),
      fromDate: jest.fn((date: Date) => new Date(date.getTime())),
    },
    FieldValue: {
      increment: jest.fn((value: number) => ({ __op: 'increment', value })),
    },
  };

  return {
    firestore,
    read: (path: string) => clone(records.get(path)),
    mutate: (path: string, data: Data) => {
      records.set(path, clone({ ...(records.get(path) ?? {}), ...data }));
    },
    writes,
    directWrites,
  };
}

function legacyOrder(overrides: Data = {}): Data {
  return {
    id: 'order-1',
    storeId: 'store-1',
    userId: 'consumer-1',
    productId: 'product-1',
    quantity: 2,
    status: 'RECRUITING',
    saleType: 'group',
    deliveryMethod: 'direct',
    totalAmount: 50000,
    ...overrides,
  };
}

function makeContext(options: { order?: Data; gc?: Data } = {}) {
  const order = legacyOrder(options.order);
  const gc = {
    productId: 'product-1',
    currentQuantity: 5,
    minQuantity: 2,
    targetQuantity: 10,
    ...(options.gc ?? {}),
  };
  const memory = makeFirestore({
    'orders/order-1': order,
    'groupProductConfig/product-1': gc,
  });
  const notifications = {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    sendToGroupParticipants: jest.fn().mockResolvedValue(undefined),
  };
  let portoneCalls = 0;
  let providerRefunded = false;
  const payments = {
    processRefundByOrderId: jest.fn(async () => {
      if (providerRefunded) return;
      portoneCalls += 1;
      providerRefunded = true;
    }),
    refundOrderChargesByOrderId: jest.fn().mockResolvedValue(undefined),
    __portoneCalls: () => portoneCalls,
    __markRefunded: () => {
      providerRefunded = true;
    },
  };
  const settlements = {
    createSettlement: jest.fn().mockResolvedValue(undefined),
    cancelSettlement: jest.fn().mockResolvedValue(undefined),
  };
  const capacity = {
    releaseReservation: jest.fn().mockResolvedValue(undefined),
    releaseReservationInTransaction: jest.fn().mockResolvedValue(undefined),
  };
  const roundLifecycle = {
    cancelByConsumer: jest.fn().mockResolvedValue({ orderId: 'order-1', status: 'CANCELLED' }),
  };
  const lifecycle = new OrdersLifecycleService(
    memory.firestore as never,
    notifications as never,
    payments as never,
    settlements as never,
    capacity as never,
    roundLifecycle as unknown as RoundOrderLifecycleService,
  );
  return { lifecycle, memory, notifications, payments, settlements, roundLifecycle };
}

describe('legacy consumer cancel refund-race convergence', () => {
  it('S1: normal RECRUITING → CANCELLED succeeds with exactly-once side effects', async () => {
    const context = makeContext();

    await expect(
      context.lifecycle.cancelOrder('store-1', 'order-1', 'consumer-1', '변심'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'CANCELLED' });

    expect(context.payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(context.payments.processRefundByOrderId).toHaveBeenCalledWith('order-1', '변심');
    expect(context.payments.__portoneCalls()).toBe(1);
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancelReason: '변심',
      cancellation: expect.objectContaining({ status: 'COMPLETED' }),
    });
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 3,
    });
    expect(context.settlements.cancelSettlement).toHaveBeenCalledTimes(1);
    expect(context.settlements.cancelSettlement).toHaveBeenCalledWith('order-1');
    expect(context.notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(context.notifications.sendToUser).toHaveBeenCalledWith(
      'consumer-1',
      'GROUP_CANCELLED_SELF',
      { orderId: 'order-1', productId: 'product-1' },
      'order-1',
      'consumer-cancel:order-1',
    );
  });

  it('S2: stale CONFIRMED before ownership performs zero provider/quantity/settlement/notification effects', async () => {
    const context = makeContext({ order: { status: 'CONFIRMED' } });

    await expect(
      context.lifecycle.cancelOrder('store-1', 'order-1', 'consumer-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(context.payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(context.payments.__portoneCalls()).toBe(0);
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 5,
    });
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'CONFIRMED' });
    expect(context.memory.read('orders/order-1')?.['cancellation']).toBeUndefined();
    expect(context.settlements.cancelSettlement).not.toHaveBeenCalled();
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('S2b: RECRUITING read then racing CONFIRMED commit before claim still refunds zero', async () => {
    const context = makeContext();
    const originalRunTransaction = context.memory.firestore.runTransaction;
    (context.memory.firestore.runTransaction as jest.Mock).mockImplementationOnce(
      async (callback: (tx: any) => Promise<unknown>) => {
        context.memory.mutate('orders/order-1', { status: 'CONFIRMED' });
        return (originalRunTransaction as jest.Mock).mock.calls.length >= 0
          ? (originalRunTransaction as unknown as (cb: (tx: any) => Promise<unknown>) => Promise<unknown>)(callback)
          : undefined;
      },
    );

    await expect(
      context.lifecycle.cancelOrder('store-1', 'order-1', 'consumer-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(context.payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 5,
    });
    expect(context.settlements.cancelSettlement).not.toHaveBeenCalled();
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('S3/S7: two concurrent cancels elect a single owner with no double quantity/refund/settlement/notification', async () => {
    const context = makeContext();

    const results = await Promise.allSettled([
      context.lifecycle.cancelOrder('store-1', 'order-1', 'consumer-1', '변심'),
      context.lifecycle.cancelOrder('store-1', 'order-1', 'consumer-1', '변심'),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);

    expect(context.payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(context.payments.__portoneCalls()).toBe(1);
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 3,
    });
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: expect.objectContaining({ status: 'COMPLETED' }),
    });
    expect(context.settlements.cancelSettlement).toHaveBeenCalledTimes(1);
    expect(context.notifications.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('S4: provider refund failure never fabricates CANCELLED and keeps retryable state', async () => {
    const context = makeContext();
    context.payments.processRefundByOrderId.mockRejectedValueOnce(new Error('환불 실패'));

    await expect(
      context.lifecycle.cancelOrder('store-1', 'order-1', 'consumer-1', '변심'),
    ).rejects.toThrow('환불 실패');

    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'RECRUITING',
      cancellation: expect.objectContaining({ status: 'REFUND_FAILED' }),
    });
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 5,
    });
    expect(context.settlements.cancelSettlement).not.toHaveBeenCalled();
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();

    await expect(
      context.lifecycle.cancelOrder('store-1', 'order-1', 'consumer-1', '변심'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'CANCELLED' });
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 3,
    });
  });

  it('S5: refund success + settlement failure converges on retry without semantic duplicate refund or quantity', async () => {
    const context = makeContext();
    context.settlements.cancelSettlement.mockRejectedValueOnce(new Error('정산 실패'));

    await expect(
      context.lifecycle.cancelOrder('store-1', 'order-1', 'consumer-1', '변심'),
    ).rejects.toThrow('정산 실패');

    expect(context.payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(context.payments.__portoneCalls()).toBe(1);
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: expect.objectContaining({ status: 'LOCAL_FAILED' }),
    });
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 3,
    });
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();

    await expect(
      context.lifecycle.cancelOrder('store-1', 'order-1', 'consumer-1', '변심'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'CANCELLED' });

    expect(context.payments.processRefundByOrderId).toHaveBeenCalledTimes(2);
    expect(context.payments.__portoneCalls()).toBe(1);
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 3,
    });
    expect(context.memory.read('orders/order-1')).toMatchObject({
      cancellation: expect.objectContaining({ status: 'COMPLETED' }),
    });
    expect(context.notifications.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('S6/S8: sequential duplicate preserves deterministic 403 without extra refund/quantity/notification', async () => {
    const context = makeContext();

    await expect(
      context.lifecycle.cancelOrder('store-1', 'order-1', 'consumer-1', '변심'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'CANCELLED' });

    await expect(
      context.lifecycle.cancelOrder('store-1', 'order-1', 'consumer-1', '변심'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(context.payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 3,
    });
    expect(context.notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: expect.objectContaining({ status: 'COMPLETED' }),
    });
  });

  it('S9: schemaVersion 2 + roundId still delegates to RoundOrderLifecycleService', async () => {
    const context = makeContext({
      order: { schemaVersion: 2, roundId: 'round-1' },
    });

    await expect(
      context.lifecycle.cancelOrder('store-1', 'order-1', 'consumer-1', '변심'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'CANCELLED' });

    expect(context.roundLifecycle.cancelByConsumer).toHaveBeenCalledWith({
      storeId: 'store-1',
      orderId: 'order-1',
      userId: 'consumer-1',
      reason: '변심',
    });
    expect(context.payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 5,
    });
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();
  });
});
