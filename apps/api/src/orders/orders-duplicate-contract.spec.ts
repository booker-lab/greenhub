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

function makeFirestore(
  initial: Record<string, Data>,
  beforeTransaction?: (records: Map<string, Data>) => void,
) {
  const records = new Map<string, Data>(
    Object.entries(initial).map(([path, data]) => [path, clone(data)]),
  );
  const writes: Write[] = [];
  const directWrites: Write[] = [];
  let tick = 0;

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
    runTransaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => {
      beforeTransaction?.(records);
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
      const result = await callback(transaction);
      records.clear();
      for (const [path, data] of staged) records.set(path, data);
      writes.push(...pendingWrites);
      return result;
    }),
    Timestamp: {
      // 호출마다 증가하는 시각: duplicate write가 발생하면 updatedAt이 달라진다.
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
    directWrites,
  };
}

function makeContext(options: {
  order?: Data;
  beforeTransaction?: (records: Map<string, Data>) => void;
} = {}) {
  const order = {
    id: 'order-1',
    storeId: 'store-1',
    userId: 'consumer-1',
    driverId: null,
    status: 'ACCEPTED',
    deliveryMethod: 'direct',
    totalAmount: 50000,
    ...options.order,
  };
  const memory = makeFirestore(
    {
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
      'users/seller-1': { id: 'seller-1', role: 'seller' },
      'orders/order-1': order,
    },
    options.beforeTransaction,
  );
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
    memory.firestore as never,
    payments as never,
    settlements as never,
    capacity as never,
  );
  const lifecycle = new OrdersLifecycleService(
    memory.firestore as never,
    notifications as never,
    payments as never,
    settlements as never,
    capacity as never,
    roundLifecycle,
  );

  return { lifecycle, memory, notifications, payments, settlements };
}

const orderWrites = (context: ReturnType<typeof makeContext>) =>
  context.memory.writes.filter((write) => write.path === 'orders/order-1');

const directOrderWrites = (context: ReturnType<typeof makeContext>) =>
  context.memory.directWrites.filter((write) => write.path === 'orders/order-1');

function expectNoDuplicateSideEffects(context: ReturnType<typeof makeContext>) {
  expect(orderWrites(context)).toHaveLength(0);
  expect(directOrderWrites(context)).toHaveLength(0);
  expect(context.memory.writes.filter((write) => write.path.startsWith('saleRounds/'))).toHaveLength(0);
  expect(context.payments.processRefundByOrderId).not.toHaveBeenCalled();
  expect(context.settlements.createSettlement).not.toHaveBeenCalled();
  expect(context.settlements.cancelSettlement).not.toHaveBeenCalled();
  expect(context.notifications.sendToUser).not.toHaveBeenCalled();
  expect(context.notifications.sendToGroupParticipants).not.toHaveBeenCalled();
}

describe('legacy plain status write duplicate-submit 계약', () => {
  it('seller legacy ACCEPTED → PREPARING race loser는 409로 종료하고 부작용을 만들지 않는다', async () => {
    const context = makeContext({
      order: { status: 'ACCEPTED' },
      // 승자가 먼저 커밋한 상황을 재현: loser의 초기 읽기는 ACCEPTED였지만
      // transaction 재확인 시점에는 이미 PREPARING이다.
      beforeTransaction: (records) => {
        records.set('orders/order-1', {
          ...records.get('orders/order-1'),
          status: 'PREPARING',
        });
      },
    });

    await expect(
      context.lifecycle.updateStatus('store-1', 'order-1', 'seller-1', {
        status: 'PREPARING',
      } as never, 'seller'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(context.memory.firestore.runTransaction).toHaveBeenCalled();
    expectNoDuplicateSideEffects(context);
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'PREPARING' });
  });

  it('seller legacy ACCEPTED → PREPARING 성공 1회 후 sequential retry는 403을 유지하고 추가 write가 없다', async () => {
    const context = makeContext({ order: { status: 'ACCEPTED' } });

    await expect(
      context.lifecycle.updateStatus('store-1', 'order-1', 'seller-1', {
        status: 'PREPARING',
      } as never, 'seller'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'PREPARING' });

    expect(orderWrites(context)).toHaveLength(1);
    expect(directOrderWrites(context)).toHaveLength(0);
    expect(context.notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(context.notifications.sendToUser).toHaveBeenCalledWith(
      'consumer-1',
      'ORDER_PREPARING',
      { orderId: 'order-1' },
      'order-1',
      undefined,
    );
    const updatedAtAfterSuccess = context.memory.read('orders/order-1')['updatedAt'];

    await expect(
      context.lifecycle.updateStatus('store-1', 'order-1', 'seller-1', {
        status: 'PREPARING',
      } as never, 'seller'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(orderWrites(context)).toHaveLength(1);
    expect(directOrderWrites(context)).toHaveLength(0);
    expect(context.notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(context.settlements.createSettlement).not.toHaveBeenCalled();
    expect(context.settlements.cancelSettlement).not.toHaveBeenCalled();
    expect(context.memory.read('orders/order-1')['updatedAt']).toEqual(updatedAtAfterSuccess);
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'PREPARING' });
  });

  it('parcel legacy PREPARING → DELIVERED race loser는 409, 성공 1회에 정산·알림 1회', async () => {
    const loser = makeContext({
      order: { status: 'PREPARING', deliveryMethod: 'parcel' },
      beforeTransaction: (records) => {
        records.set('orders/order-1', {
          ...records.get('orders/order-1'),
          status: 'DELIVERED',
        });
      },
    });

    await expect(
      loser.lifecycle.updateStatus('store-1', 'order-1', 'seller-1', {
        status: 'DELIVERED',
      } as never, 'seller'),
    ).rejects.toBeInstanceOf(ConflictException);

    expectNoDuplicateSideEffects(loser);

    const winner = makeContext({
      order: { status: 'PREPARING', deliveryMethod: 'parcel' },
    });

    await expect(
      winner.lifecycle.updateStatus('store-1', 'order-1', 'seller-1', {
        status: 'DELIVERED',
      } as never, 'seller'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'DELIVERED' });

    expect(orderWrites(winner)).toHaveLength(1);
    expect(directOrderWrites(winner)).toHaveLength(0);
    expect(winner.settlements.createSettlement).toHaveBeenCalledTimes(1);
    expect(winner.settlements.cancelSettlement).not.toHaveBeenCalled();
    expect(winner.notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(winner.notifications.sendToUser).toHaveBeenCalledWith(
      'consumer-1',
      'ORDER_DELIVERED',
      { orderId: 'order-1' },
      'order-1',
      undefined,
    );
    const updatedAtAfterSuccess = winner.memory.read('orders/order-1')['updatedAt'];

    await expect(
      winner.lifecycle.updateStatus('store-1', 'order-1', 'seller-1', {
        status: 'DELIVERED',
      } as never, 'seller'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(orderWrites(winner)).toHaveLength(1);
    expect(winner.settlements.createSettlement).toHaveBeenCalledTimes(1);
    expect(winner.notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(winner.memory.read('orders/order-1')['updatedAt']).toEqual(updatedAtAfterSuccess);
  });

  it('roundId 없는 legacy hold 전이는 transaction으로 보호되고 retry 시 403·카운터 drift가 없다', async () => {
    const deliveryHold = {
      reasonCode: 'ACCESS_UNAVAILABLE',
      reasonMessage: '공동현관 출입 불가',
      customerResponsible: false,
    };
    const loser = makeContext({
      order: { status: 'PREPARING', deliveryMethod: 'direct' },
      beforeTransaction: (records) => {
        records.set('orders/order-1', {
          ...records.get('orders/order-1'),
          status: 'DELIVERY_HELD',
        });
      },
    });

    await expect(
      loser.lifecycle.updateStatus('store-1', 'order-1', 'seller-1', {
        status: 'DELIVERY_HELD',
        deliveryHold,
      } as never, 'seller'),
    ).rejects.toBeInstanceOf(ConflictException);

    expectNoDuplicateSideEffects(loser);

    const winner = makeContext({
      order: { status: 'PREPARING', deliveryMethod: 'direct' },
    });

    await expect(
      winner.lifecycle.updateStatus('store-1', 'order-1', 'seller-1', {
        status: 'DELIVERY_HELD',
        deliveryHold,
      } as never, 'seller'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'DELIVERY_HELD' });

    expect(orderWrites(winner)).toHaveLength(1);
    expect(directOrderWrites(winner)).toHaveLength(0);
    expect(winner.memory.writes.filter((write) => write.path.startsWith('saleRounds/'))).toHaveLength(0);
    expect(winner.notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(winner.notifications.sendToUser).toHaveBeenCalledWith(
      'consumer-1',
      'ORDER_DELIVERY_HELD',
      expect.objectContaining({ orderId: 'order-1' }),
      'order-1',
      undefined,
    );
    const heldAtAfterSuccess = winner.memory.read('orders/order-1')['deliveryHold']['heldAt'];
    const updatedAtAfterSuccess = winner.memory.read('orders/order-1')['updatedAt'];

    await expect(
      winner.lifecycle.updateStatus('store-1', 'order-1', 'seller-1', {
        status: 'DELIVERY_HELD',
        deliveryHold,
      } as never, 'seller'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(orderWrites(winner)).toHaveLength(1);
    expect(winner.notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(winner.settlements.createSettlement).not.toHaveBeenCalled();
    expect(winner.settlements.cancelSettlement).not.toHaveBeenCalled();
    expect(winner.memory.read('orders/order-1')['deliveryHold']['heldAt']).toEqual(
      heldAtAfterSuccess,
    );
    expect(winner.memory.read('orders/order-1')['updatedAt']).toEqual(updatedAtAfterSuccess);
  });
});
