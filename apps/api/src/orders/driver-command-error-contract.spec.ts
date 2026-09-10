import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';
import { OrdersLifecycleService } from './orders-lifecycle.service';
import { DriverService } from '../driver/driver.service';
import { DriverOrderScopeService } from './driver-order-scope.service';
import { OrdersQueryService } from './orders-query.service';
import { DeliveryPhotosService } from './delivery-photos.service';
import { readHttpExceptionBody } from './driver-order-error';

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
  const writes: Array<{ operation: string; path: string; data: Data }> = [];

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
    collection: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      get: jest.fn(async () => ({ docs: [] })),
    })),
    runTransaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => {
      beforeTransaction?.(records);
      const staged = new Map<string, Data>(
        Array.from(records.entries()).map(([path, data]) => [path, clone(data)]),
      );
      const pending: Array<{ operation: string; path: string; data: Data }> = [];
      const transaction = {
        get: jest.fn(async (ref: { path: string }) => snapshot(ref.path, staged)),
        set: jest.fn((ref: { path: string }, data: Data) => {
          pending.push({ operation: 'set', path: ref.path, data: clone(data) });
          staged.set(ref.path, clone(data));
        }),
        update: jest.fn((ref: { path: string }, data: Data) => {
          const current = staged.get(ref.path);
          if (!current) throw new Error(`존재하지 않는 문서입니다: ${ref.path}`);
          pending.push({ operation: 'update', path: ref.path, data: clone(data) });
          staged.set(ref.path, applyPatch(current, data));
        }),
      };
      const result = await callback(transaction);
      records.clear();
      for (const [path, data] of staged) records.set(path, data);
      writes.push(...pending);
      return result;
    }),
    Timestamp: {
      now: jest.fn(() => new Date('2026-09-10T00:00:00.000Z')),
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

function makeLifecycle(
  initial: Record<string, Data>,
  beforeTransaction?: (records: Map<string, Data>) => void,
) {
  const memory = makeFirestore(initial, beforeTransaction);
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

function roundDirectRecords(orderOverrides: Data = {}, driverOverrides: Data = {}) {
  const order = {
    id: 'order-1',
    storeId: 'store-1',
    userId: 'consumer-1',
    driverId: null,
    status: 'PREPARING',
    deliveryMethod: 'direct',
    schemaVersion: 2,
    roundId: 'round-1',
    ...orderOverrides,
  };
  return {
    'stores/store-1': { id: 'store-1', ownerId: 'seller-1', salesMode: 'round_direct' },
    'saleRounds/round-1': { id: 'round-1', storeId: 'store-1', counters: { heldOrderCount: 0 } },
    'users/driver-a': { id: 'driver-a', role: 'driver', driverApproved: true, ...driverOverrides },
    'users/driver-b': { id: 'driver-b', role: 'driver', driverApproved: true },
    'orders/order-1': order,
  };
}

function expectEnvelope(
  error: unknown,
  expected: { status: number; statusCode: number; error: string; code: string },
) {
  expect(error).toBeInstanceOf(
    expected.status === 403
      ? ForbiddenException
      : expected.status === 404
        ? NotFoundException
        : ConflictException,
  );
  const http = error as { getStatus: () => number };
  expect(http.getStatus()).toBe(expected.status);
  const body = readHttpExceptionBody(error);
  expect(body).toMatchObject({
    statusCode: expected.statusCode,
    error: expected.error,
    code: expected.code,
  });
  expect(typeof (body as Data)['message']).toBe('string');
}

describe('driver command error code contract', () => {
  it('authority denial keeps 403 with AUTHORITY code and no side effects', async () => {
    const context = makeLifecycle(roundDirectRecords({}, { suspended: true }));

    const error = await context.lifecycle
      .updateStatus('store-1', 'order-1', 'driver-a', { status: 'DELIVERING' } as never, 'driver')
      .then(
        () => null,
        (failure: unknown) => failure,
      );

    expect(error).not.toBeNull();
    expectEnvelope(error, {
      status: 403,
      statusCode: 403,
      error: 'Forbidden',
      code: 'DRIVER_ORDER_AUTHORITY_DENIED',
    });
    expect(context.memory.writes.filter((write) => write.path === 'orders/order-1')).toHaveLength(
      0,
    );
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'PREPARING' });
  });

  it('other-driver assigned mutation keeps 403 with AUTHORITY code', async () => {
    const context = makeLifecycle(
      roundDirectRecords({ status: 'DELIVERING', driverId: 'driver-b' }),
    );

    const error = await context.lifecycle
      .updateStatus(
        'store-1',
        'order-1',
        'driver-a',
        { status: 'DELIVERED' } as never,
        'driver',
      )
      .then(
        () => null,
        (failure: unknown) => failure,
      );

    expectEnvelope(error, {
      status: 403,
      statusCode: 403,
      error: 'Forbidden',
      code: 'DRIVER_ORDER_AUTHORITY_DENIED',
    });
    expect(context.memory.writes.filter((write) => write.path === 'orders/order-1')).toHaveLength(
      0,
    );
  });

  it('sequential invalid transition keeps 403 with STATE code', async () => {
    const context = makeLifecycle(
      roundDirectRecords({ status: 'DELIVERING', driverId: 'driver-a' }),
    );

    const error = await context.lifecycle
      .updateStatus(
        'store-1',
        'order-1',
        'driver-a',
        { status: 'PREPARING' } as never,
        'driver',
      )
      .then(
        () => null,
        (failure: unknown) => failure,
      );

    expectEnvelope(error, {
      status: 403,
      statusCode: 403,
      error: 'Forbidden',
      code: 'DRIVER_ORDER_STATE_CONFLICT',
    });
    expect(context.memory.writes.filter((write) => write.path === 'orders/order-1')).toHaveLength(
      0,
    );
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('transaction race loser keeps 409 with STATE code', async () => {
    const context = makeLifecycle(roundDirectRecords(), (records) => {
      records.set('orders/order-1', {
        ...records.get('orders/order-1'),
        status: 'DELIVERING',
        driverId: 'driver-b',
      });
    });

    const error = await context.lifecycle
      .updateStatus('store-1', 'order-1', 'driver-a', { status: 'DELIVERING' } as never, 'driver')
      .then(
        () => null,
        (failure: unknown) => failure,
      );

    expectEnvelope(error, {
      status: 409,
      statusCode: 409,
      error: 'Conflict',
      code: 'DRIVER_ORDER_STATE_CONFLICT',
    });
    expect(context.memory.writes.filter((write) => write.path === 'orders/order-1')).toHaveLength(
      0,
    );
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('driver 404 boundary keeps 404 with NOT_FOUND code and hides existence', async () => {
    const context = makeLifecycle(roundDirectRecords());

    const missing = await context.lifecycle
      .updateStatus(
        'store-1',
        'order-missing',
        'driver-a',
        { status: 'DELIVERING' } as never,
        'driver',
      )
      .then(
        () => null,
        (failure: unknown) => failure,
      );
    expectEnvelope(missing, {
      status: 404,
      statusCode: 404,
      error: 'Not Found',
      code: 'DRIVER_ORDER_NOT_FOUND',
    });

    const memory = makeFirestore({
      'users/driver-1': { id: 'driver-1', role: 'driver', driverApproved: true },
      'orders/other-driver': {
        storeId: 'store-1',
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-2',
      },
    });
    const ordersQuery = new OrdersQueryService(memory.firestore as never);
    const driverScope = new DriverOrderScopeService(memory.firestore as never);
    const driverService = new DriverService(
      memory.firestore as never,
      ordersQuery,
      driverScope,
    );
    const hidden = await driverService.getOrder('driver-1', 'other-driver').then(
      () => null,
      (failure: unknown) => failure,
    );
    expectEnvelope(hidden, {
      status: 404,
      statusCode: 404,
      error: 'Not Found',
      code: 'DRIVER_ORDER_NOT_FOUND',
    });
  });

  it('driver redelivery resume without PAID keeps 409 with STATE code', async () => {
    const holdAt = '2026-09-10T00:00:00.000Z';
    const context = makeLifecycle({
      ...roundDirectRecords({
        status: 'DELIVERY_HELD',
        driverId: 'driver-a',
        deliveryHold: {
          heldAt: holdAt,
          reasonCode: 'ACCESS_UNAVAILABLE',
          reasonMessage: '배송지 출입 불가',
          customerResponsible: true,
          redeliveryFee: 5000,
          nextContactAt: null,
          nextDeliveryAt: null,
          resolvedAt: null,
        },
        redeliveryChargeId: 'charge-1',
        redeliveryChargeHoldAt: holdAt,
      }),
      'orderCharges/charge-1': {
        id: 'charge-1',
        orderId: 'order-1',
        storeId: 'store-1',
        userId: 'consumer-1',
        type: 'REDELIVERY_FEE',
        status: 'PENDING',
        amount: 5000,
        customerResponsible: true,
        holdAt,
        portonePaymentId: 'order-charge-charge-1',
      },
    });

    const error = await context.lifecycle
      .updateStatus('store-1', 'order-1', 'driver-a', { status: 'DELIVERING' } as never, 'driver')
      .then(
        () => null,
        (failure: unknown) => failure,
      );

    expectEnvelope(error, {
      status: 409,
      statusCode: 409,
      error: 'Conflict',
      code: 'DRIVER_ORDER_STATE_CONFLICT',
    });
  });

  it('photo duplicate keeps 409 with STATE code without storage semantics change', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
    let order: Data = {
      id: 'order-1',
      storeId: 'store-1',
      driverId: 'driver-a',
      schemaVersion: 2,
      roundId: 'round-1',
      deliveryMethod: 'direct',
      status: 'DELIVERING',
      deliveryPhotoIds: ['photo-existing'],
    };
    const transaction = {
      get: jest.fn(async () => ({ exists: true, data: () => ({ ...order }) })),
      update: jest.fn((_: unknown, changes: Data) => {
        order = { ...order, ...changes };
      }),
    };
    const firestore = {
      doc: jest.fn((path: string) => ({
        path,
        get: jest.fn(async () => ({ exists: true, data: () => ({ ...order }) })),
      })),
      runTransaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
      Timestamp: { now: jest.fn(() => ({ toDate: () => new Date('2026-09-10T00:00:00.000Z') })) },
    };
    const storage = {
      uploadDeliveryPhoto: jest.fn(async (input: Data) => ({
        orderId: input.orderId,
        photoId: input.photoId,
        path: `deliveryPhotos/${input.orderId}/${input.photoId}.jpg`,
        created: true,
      })),
      reconcileDeliveryPhoto: jest.fn(),
      createDeliveryPhotoReadUrl: jest.fn(),
      deleteObject: jest.fn(),
    };
    const service = new DeliveryPhotosService(
      firestore as never,
      storage as never,
      { saveRecord: jest.fn().mockResolvedValue({ id: '기록' }) } as never,
      { updateStatus: jest.fn(), reconcileDeliveryCompletion: jest.fn() } as never,
      undefined as never,
      { createOrMergeIssue: jest.fn() } as never,
    );
    (service as Data)['driverScope'] = new DriverOrderScopeService(firestore as never);

    const error = await service
      .uploadAndComplete({
        storeId: 'store-1',
        orderId: 'order-1',
        requesterId: 'driver-a',
        requesterRole: 'driver',
        idempotencyKey: 'request-new-photo',
        content: jpeg,
        contentType: 'image/jpeg',
      })
      .then(
        () => null,
        (failure: unknown) => failure,
      );

    expectEnvelope(error, {
      status: 409,
      statusCode: 409,
      error: 'Conflict',
      code: 'DRIVER_ORDER_STATE_CONFLICT',
    });
  });

  it('successful driver first claim is unchanged and carries no error code', async () => {
    const context = makeLifecycle(roundDirectRecords());

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
  });

  it('seller sequential retry still uses plain 403 without driver code', async () => {
    const context = makeLifecycle({
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
      'users/seller-1': { id: 'seller-1', role: 'seller' },
      'orders/order-1': {
        id: 'order-1',
        storeId: 'store-1',
        userId: 'consumer-1',
        driverId: null,
        status: 'ACCEPTED',
        deliveryMethod: 'direct',
        totalAmount: 50000,
      },
    });

    await expect(
      context.lifecycle.updateStatus(
        'store-1',
        'order-1',
        'seller-1',
        { status: 'PREPARING' } as never,
        'seller',
      ),
    ).resolves.toEqual({ orderId: 'order-1', status: 'PREPARING' });

    const error = await context.lifecycle
      .updateStatus('store-1', 'order-1', 'seller-1', { status: 'PREPARING' } as never, 'seller')
      .then(
        () => null,
        (failure: unknown) => failure,
      );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getStatus()).toBe(403);
    expect(readHttpExceptionBody(error)).not.toHaveProperty('code');
  });
});
