// group-confirmed-quantity-restoration.spec.ts — TASK GROUP-CONFIRMED-QUANTITY-RESTORATION-01
//
// Focused invariant spec: a legacy group order contributes its quantity to
// groupProductConfig.currentQuantity until it terminates as CANCELLED, at which
// point exactly one restoration of -order.quantity must converge, atomically with
// the successful local cancellation. Covers:
// - seller CONFIRMED group cancel (exactly-once, duplicate/concurrent, fault, underflow)
// - admin CONFIRMED group forceRefund (exactly-once, retry, cross-path convergence, fault)
// - non-group seller cancel (zero group mutation)
// - round/schemaVersion:2 delegation (zero group mutation)
//
// Existing consumer RECRUITING convergence, normal/daily-cap and round regression
// meaning is owned by their own specs and is not rewritten here.

import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AdminService } from '../admin/admin.service';
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
        records.set(path, clone(data));
      }),
      update: jest.fn(async (data: Data) => {
        const current = records.get(path);
        if (!current) throw new Error(`존재하지 않는 문서입니다: ${path}`);
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
    writes,
    groupWrites: () => writes.filter((write) => write.path.startsWith('groupProductConfig/')),
  };
}

// Provider-level refund counting with real PaymentRefundService idempotency semantics:
// the first service call performs one provider refund, later calls converge to no-op.
function makeIdempotentPayments() {
  let providerRefunds = 0;
  let providerDone = false;
  const payments = {
    processRefundByOrderId: jest.fn(async () => {
      if (providerDone) return;
      providerDone = true;
      providerRefunds += 1;
    }),
    __providerRefunds: () => providerRefunds,
    __markProviderDone: () => {
      providerDone = true;
    },
  };
  return payments;
}

function groupOrder(overrides: Data = {}): Data {
  return {
    id: 'order-1',
    storeId: 'store-1',
    userId: 'consumer-1',
    productId: 'product-1',
    quantity: 2,
    status: 'CONFIRMED',
    saleType: 'group',
    deliveryMethod: 'direct',
    totalAmount: 50000,
    ...overrides,
  };
}

function makeSellerContext(options: { order?: Data; gc?: Data | null } = {}) {
  const order = groupOrder(options.order);
  const initial: Record<string, Data> = {
    'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
    'orders/order-1': order,
  };
  if (options.gc !== null) {
    initial['groupProductConfig/product-1'] = {
      productId: 'product-1',
      currentQuantity: 7,
      minQuantity: 2,
      targetQuantity: 10,
      ...(options.gc ?? {}),
    };
  }
  const memory = makeFirestore(initial);
  const notifications = {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    sendToGroupParticipants: jest.fn().mockResolvedValue(undefined),
  };
  const payments = makeIdempotentPayments();
  const settlements = {
    createSettlement: jest.fn().mockResolvedValue(undefined),
    cancelSettlement: jest.fn().mockResolvedValue(undefined),
  };
  const roundLifecycle = {
    updateStatus: jest.fn().mockResolvedValue({ orderId: 'order-1', status: 'CANCELLED' }),
    cancelByConsumer: jest.fn(),
  };
  const lifecycle = new OrdersLifecycleService(
    memory.firestore as never,
    notifications as never,
    payments as never,
    settlements as never,
    {} as never,
    roundLifecycle as unknown as RoundOrderLifecycleService,
  );
  return { lifecycle, memory, notifications, payments, settlements, roundLifecycle };
}

function makeAdminContext(options: { order?: Data; gc?: Data | null } = {}) {
  const order = groupOrder(options.order);
  const initial: Record<string, Data> = {
    'orders/order-1': order,
  };
  if (options.gc !== null) {
    initial['groupProductConfig/product-1'] = {
      productId: 'product-1',
      currentQuantity: 7,
      minQuantity: 2,
      targetQuantity: 10,
      ...(options.gc ?? {}),
    };
  }
  const memory = makeFirestore(initial);
  const payments = makeIdempotentPayments();
  const settlements = { cancelSettlement: jest.fn().mockResolvedValue(undefined) };
  const roundLifecycle = {
    cancelForRound: jest.fn().mockResolvedValue({ orderId: 'order-1', status: 'CANCELLED' }),
  };
  const service = new AdminService(
    memory.firestore as never,
    payments as never,
    settlements as never,
    roundLifecycle as never,
  );
  return { service, memory, payments, settlements, roundLifecycle };
}

const sellerCancel = (context: ReturnType<typeof makeSellerContext>, orderId = 'order-1') =>
  context.lifecycle.updateStatus(
    'store-1',
    orderId,
    'seller-1',
    { status: 'CANCELLED', reason: '재고 부족' } as never,
    'seller',
  );

describe('seller CONFIRMED group quantity restoration', () => {
  it('restores exactly Q once with CANCELLED + single provider refund', async () => {
    const context = makeSellerContext();

    await expect(sellerCancel(context)).resolves.toEqual({
      orderId: 'order-1',
      status: 'CANCELLED',
    });

    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'CANCELLED' });
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 5,
    });
    expect(context.memory.groupWrites()).toHaveLength(1);
    expect(context.payments.__providerRefunds()).toBe(1);
    expect(context.settlements.cancelSettlement).toHaveBeenCalledTimes(1);
  });

  it('sequential duplicate adds zero further restoration', async () => {
    const context = makeSellerContext();

    await expect(sellerCancel(context)).resolves.toEqual({
      orderId: 'order-1',
      status: 'CANCELLED',
    });
    await expect(sellerCancel(context)).rejects.toBeInstanceOf(ForbiddenException);

    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 5,
    });
    expect(context.memory.groupWrites()).toHaveLength(1);
    expect(context.payments.__providerRefunds()).toBe(1);
    expect(context.settlements.cancelSettlement).toHaveBeenCalledTimes(1);
  });

  it('concurrent duplicates converge to a single restoration', async () => {
    const context = makeSellerContext();

    const results = await Promise.allSettled([sellerCancel(context), sellerCancel(context)]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'CANCELLED' });
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 5,
    });
    expect(context.memory.groupWrites()).toHaveLength(1);
    expect(context.payments.__providerRefunds()).toBe(1);
  });

  it('non-group seller cancellation never mutates groupProductConfig', async () => {
    const context = makeSellerContext({
      order: {
        status: 'ACCEPTED',
        saleType: 'normal',
        deliveryMethod: 'parcel',
        quantity: 1,
      },
    });

    await expect(sellerCancel(context)).resolves.toEqual({
      orderId: 'order-1',
      status: 'CANCELLED',
    });

    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'CANCELLED' });
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 7,
    });
    expect(context.memory.groupWrites()).toHaveLength(0);
  });

  it('missing groupProductConfig does not block cancellation', async () => {
    const context = makeSellerContext({ gc: null });

    await expect(sellerCancel(context)).resolves.toEqual({
      orderId: 'order-1',
      status: 'CANCELLED',
    });

    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'CANCELLED' });
    expect(context.memory.groupWrites()).toHaveLength(0);
  });

  it('counter failure leaves order + counter untouched and retry restores once', async () => {
    const context = makeSellerContext();
    (context.memory.firestore.FieldValue.increment as jest.Mock).mockImplementationOnce(() => {
      throw new Error('counter infra down');
    });

    await expect(sellerCancel(context)).rejects.toThrow('counter infra down');
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'CONFIRMED' });
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 7,
    });
    expect(context.memory.groupWrites()).toHaveLength(0);

    await expect(sellerCancel(context)).resolves.toEqual({
      orderId: 'order-1',
      status: 'CANCELLED',
    });
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 5,
    });
    expect(context.memory.groupWrites()).toHaveLength(1);
    expect(context.payments.__providerRefunds()).toBe(1);
  });

  it('underflow fails closed without clamping the counter', async () => {
    const context = makeSellerContext({ gc: { currentQuantity: 1 } });

    await expect(sellerCancel(context)).rejects.toBeInstanceOf(ConflictException);
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'CONFIRMED' });
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 1,
    });
    expect(context.memory.groupWrites()).toHaveLength(0);
  });

  it('round/schemaVersion:2 seller cancel still delegates without group mutation', async () => {
    const context = makeSellerContext({
      order: { schemaVersion: 2, roundId: 'round-1', reservationId: 'reservation-1' },
    });

    await expect(sellerCancel(context)).resolves.toEqual({
      orderId: 'order-1',
      status: 'CANCELLED',
    });

    expect(context.roundLifecycle.updateStatus).toHaveBeenCalledTimes(1);
    expect(context.payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 7,
    });
    expect(context.memory.groupWrites()).toHaveLength(0);
  });
});

describe('admin CONFIRMED group forceRefund restoration', () => {
  it('restores exactly Q once with a single provider refund', async () => {
    const context = makeAdminContext();

    await expect(context.service.forceRefund('order-1', {})).resolves.toEqual({
      ok: true,
      orderId: 'order-1',
    });

    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: expect.objectContaining({ status: 'COMPLETED' }),
    });
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 5,
    });
    expect(context.memory.groupWrites()).toHaveLength(1);
    expect(context.payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(context.payments.__providerRefunds()).toBe(1);
    expect(context.settlements.cancelSettlement).toHaveBeenCalledTimes(1);
  });

  it('retry after success adds zero provider/quantity effects', async () => {
    const context = makeAdminContext();

    await expect(context.service.forceRefund('order-1', {})).resolves.toEqual({
      ok: true,
      orderId: 'order-1',
    });
    await expect(context.service.forceRefund('order-1', {})).resolves.toEqual({
      ok: true,
      orderId: 'order-1',
    });

    expect(context.payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(context.payments.__providerRefunds()).toBe(1);
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 5,
    });
    expect(context.memory.groupWrites()).toHaveLength(1);
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: expect.objectContaining({ status: 'COMPLETED' }),
    });
  });

  it('seller-cancelled order converges without a second restoration', async () => {
    const context = makeAdminContext({
      order: { status: 'CANCELLED' },
      gc: { currentQuantity: 5 },
    });
    // The seller path already refunded at the provider before this admin retry.
    context.payments.__markProviderDone();

    await expect(context.service.forceRefund('order-1', {})).resolves.toEqual({
      ok: true,
      orderId: 'order-1',
    });

    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: expect.objectContaining({ status: 'COMPLETED' }),
    });
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 5,
    });
    expect(context.memory.groupWrites()).toHaveLength(0);
    expect(context.payments.__providerRefunds()).toBe(0);
  });

  it('local failure restores nothing and retry restores once with single provider refund', async () => {
    const context = makeAdminContext();
    const original = context.memory.firestore.runTransaction.getMockImplementation() as (
      callback: (transaction: any) => Promise<unknown>,
    ) => Promise<unknown>;
    let transactionCalls = 0;
    (context.memory.firestore.runTransaction as jest.Mock).mockImplementation(
      (callback: (transaction: any) => Promise<unknown>) => {
        transactionCalls += 1;
        // 1st call is the refund claim, 2nd is the local cancellation apply.
        if (transactionCalls === 2) return Promise.reject(new Error('local infra down'));
        return (original as (callback: (transaction: any) => Promise<unknown>) => Promise<unknown>)(
          callback,
        );
      },
    );

    await expect(context.service.forceRefund('order-1', {})).rejects.toThrow('local infra down');
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'CONFIRMED',
      cancellation: expect.objectContaining({ status: 'LOCAL_FAILED' }),
    });
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 7,
    });
    expect(context.memory.groupWrites()).toHaveLength(0);

    await expect(context.service.forceRefund('order-1', {})).resolves.toEqual({
      ok: true,
      orderId: 'order-1',
    });
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 5,
    });
    expect(context.memory.groupWrites()).toHaveLength(1);
    expect(context.payments.processRefundByOrderId).toHaveBeenCalledTimes(2);
    expect(context.payments.__providerRefunds()).toBe(1);
  });

  it('underflow fails closed without clamping the counter', async () => {
    const context = makeAdminContext({ gc: { currentQuantity: 1 } });

    await expect(context.service.forceRefund('order-1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'CONFIRMED',
      cancellation: expect.objectContaining({ status: 'LOCAL_FAILED' }),
    });
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 1,
    });
    expect(context.memory.groupWrites()).toHaveLength(0);
  });

  it('round/schemaVersion:2 admin refund still delegates without group mutation', async () => {
    const context = makeAdminContext({
      order: { schemaVersion: 2, roundId: 'round-1', reservationId: 'reservation-1' },
    });

    await expect(context.service.forceRefund('order-1', { reason: '관리자 사유' })).resolves.toEqual({
      orderId: 'order-1',
      status: 'CANCELLED',
    });

    expect(context.roundLifecycle.cancelForRound).toHaveBeenCalledWith({
      storeId: 'store-1',
      orderId: 'order-1',
      expectedStatus: 'CONFIRMED',
      reason: '관리자 사유',
    });
    expect(context.payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(context.memory.read('groupProductConfig/product-1')).toMatchObject({
      currentQuantity: 7,
    });
    expect(context.memory.groupWrites()).toHaveLength(0);
  });
});
