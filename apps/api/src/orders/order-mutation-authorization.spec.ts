import { ForbiddenException } from '@nestjs/common';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';
import { OrdersLifecycleService } from './orders-lifecycle.service';

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
        writes.push({ operation: 'set', path, data: clone(data) });
        records.set(path, clone(data));
      }),
      update: jest.fn(async (data: Data) => {
        const current = records.get(path);
        if (!current) throw new Error(`존재하지 않는 문서입니다: ${path}`);
        writes.push({ operation: 'update', path, data: clone(data) });
        records.set(path, applyPatch(current, data));
      }),
    };
  }

  const firestore = {
    doc,
    runTransaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => {
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
      now: jest.fn(() => new Date('2026-08-27T00:00:00.000Z')),
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
  };
}

function makeContext(options: { order?: Data; store?: Data } = {}) {
  const order = {
    id: 'order-1',
    storeId: 'store-1',
    userId: 'consumer-1',
    driverId: null,
    status: 'PREPARING',
    deliveryMethod: 'direct',
    ...options.order,
  };
  const storeId = order.storeId as string;
  const memory = makeFirestore({
    [`stores/${storeId}`]: {
      id: storeId,
      ownerId: 'seller-1',
      ...options.store,
    },
    'orders/order-1': order,
  });
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

  return { capacity, lifecycle, memory, notifications, payments, settlements };
}

const deliveryHold = {
  reasonCode: 'ACCESS_UNAVAILABLE',
  reasonMessage: '공동현관 출입 불가',
  customerResponsible: false,
};

function expectNoSideEffects(context: ReturnType<typeof makeContext>) {
  expect(context.memory.writes.filter((write) => write.path.startsWith('orders/'))).toHaveLength(0);
  expect(context.payments.processRefundByOrderId).not.toHaveBeenCalled();
  expect(context.payments.refundOrderChargesByOrderId).not.toHaveBeenCalled();
  expect(context.settlements.createSettlement).not.toHaveBeenCalled();
  expect(context.settlements.cancelSettlement).not.toHaveBeenCalled();
  expect(context.capacity.releaseReservation).not.toHaveBeenCalled();
  expect(context.capacity.releaseReservationInTransaction).not.toHaveBeenCalled();
  expect(context.notifications.sendToUser).not.toHaveBeenCalled();
  expect(context.notifications.sendToGroupParticipants).not.toHaveBeenCalled();
}

describe('ORD-01 주문 mutation authorization 회귀', () => {
  it.each([
    {
      name: 'seller A의 타-store 주문 상태 변경',
      requesterId: 'seller-a',
      role: 'seller',
      order: { storeId: 'store-b', status: 'ACCEPTED' },
      store: { ownerId: 'seller-b' },
      request: { status: 'PREPARING' },
    },
    {
      name: 'seller A의 타-store 배송 보류',
      requesterId: 'seller-a',
      role: 'seller',
      order: { storeId: 'store-b', status: 'PREPARING' },
      store: { ownerId: 'seller-b' },
      request: { status: 'DELIVERY_HELD', deliveryHold },
    },
    {
      name: '다른 driver에게 배정된 주문 변경',
      requesterId: 'driver-a',
      role: 'driver',
      order: { status: 'PREPARING', driverId: 'driver-b' },
      request: { status: 'DELIVERING' },
    },
    {
      name: '허용되지 않은 상태의 미배정 주문 first claim',
      requesterId: 'driver-a',
      role: 'driver',
      order: { status: 'CONFIRMED', driverId: null },
      request: { status: 'DELIVERING' },
    },
    {
      name: 'parcel discovery first claim',
      requesterId: 'driver-a',
      role: 'driver',
      order: { status: 'PREPARING', deliveryMethod: 'parcel', driverId: null },
      request: { status: 'DELIVERING' },
    },
    {
      name: '비담당 driver의 배송 보류',
      requesterId: 'driver-a',
      role: 'driver',
      order: { status: 'DELIVERING', driverId: 'driver-b' },
      request: { status: 'DELIVERY_HELD', deliveryHold },
    },
    {
      name: '비담당 driver의 배송 완료',
      requesterId: 'driver-a',
      role: 'driver',
      order: { status: 'DELIVERING', driverId: 'driver-b' },
      request: { status: 'DELIVERED' },
    },
    {
      name: '타인 주문 mutation',
      requesterId: 'consumer-a',
      role: 'consumer',
      order: { userId: 'consumer-b', status: 'DELIVERED' },
      request: { status: 'REVIEWED' },
    },
    {
      name: 'consumer의 seller 전용 배송 보류 전이',
      requesterId: 'consumer-1',
      role: 'consumer',
      order: { status: 'PREPARING' },
      request: { status: 'DELIVERY_HELD', deliveryHold },
    },
    {
      name: 'consumer의 driver 전용 배송 완료 우회',
      requesterId: 'consumer-1',
      role: 'consumer',
      order: { status: 'DELIVERING', driverId: 'driver-b' },
      request: { status: 'DELIVERED' },
    },
  ])('$name은 거부하고 모든 부작용을 만들지 않는다', async (scenario) => {
    const context = makeContext({ order: scenario.order, store: scenario.store });
    const storeId = scenario.order.storeId ?? 'store-1';

    await expect(
      context.lifecycle.updateStatus(
        storeId,
        'order-1',
        scenario.requesterId,
        scenario.request as never,
        scenario.role,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expectNoSideEffects(context);
  });

  it('정상 seller mutation은 주문 상태를 변경하고 허용된 알림만 보낸다', async () => {
    const context = makeContext({ order: { status: 'ACCEPTED' } });

    await expect(
      context.lifecycle.updateStatus(
        'store-1',
        'order-1',
        'seller-1',
        { status: 'PREPARING' } as never,
        'seller',
      ),
    ).resolves.toEqual({ orderId: 'order-1', status: 'PREPARING' });

    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'PREPARING' });
    expect(context.memory.writes.filter((write) => write.path === 'orders/order-1')).toHaveLength(1);
    expect(context.notifications.sendToUser).toHaveBeenCalledWith(
      'consumer-1',
      'ORDER_PREPARING',
      { orderId: 'order-1' },
      'order-1',
      undefined,
    );
  });

  it.each(['direct', 'hub'] as const)(
    '정상 미배정 %s 주문 first claim은 driver를 원자적으로 배정한다',
    async (deliveryMethod) => {
      const context = makeContext({
        order: {
          schemaVersion: 2,
          roundId: 'round-1',
          deliveryMethod,
          status: 'PREPARING',
          driverId: null,
        },
      });

      await expect(
        context.lifecycle.updateStatus(
          'store-1',
          'order-1',
          'driver-a',
          { status: 'DELIVERING' } as never,
          'driver',
        ),
      ).resolves.toEqual({ orderId: 'order-1', status: 'DELIVERING' });

      expect(context.memory.read('orders/order-1')).toMatchObject({
        status: 'DELIVERING',
        driverId: 'driver-a',
      });
      expect(context.memory.writes.filter((write) => write.path === 'orders/order-1')).toHaveLength(1);
    },
  );

  it('정상 배정 driver의 배송 완료 mutation을 허용한다', async () => {
    const context = makeContext({
      order: {
        schemaVersion: 2,
        roundId: 'round-1',
        status: 'DELIVERING',
        driverId: 'driver-a',
        deliveryMethod: 'direct',
        deliveryPhotoIds: ['photo-1'],
      },
    });

    await expect(
      context.lifecycle.updateStatus(
        'store-1',
        'order-1',
        'driver-a',
        { status: 'DELIVERED' } as never,
        'driver',
      ),
    ).resolves.toEqual({ orderId: 'order-1', status: 'DELIVERED' });

    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'DELIVERED' });
    expect(context.settlements.createSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-1', status: 'DELIVERED' }),
      'DELIVERED',
    );
    expect(context.notifications.sendToUser).toHaveBeenCalledWith(
      'consumer-1',
      'ORDER_DELIVERED',
      { orderId: 'order-1' },
      'order-1',
      'order-transition:order-1:DELIVERING:DELIVERED',
    );
  });

  it('정상 consumer-owned review action을 허용한다', async () => {
    const context = makeContext({ order: { status: 'DELIVERED' } });

    await expect(context.lifecycle.reviewOrder('store-1', 'order-1', 'consumer-1')).resolves.toEqual({
      orderId: 'order-1',
      status: 'REVIEWED',
    });

    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'REVIEWED' });
    expect(context.settlements.createSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-1', status: 'DELIVERED' }),
      'REVIEWED',
    );
  });
});
