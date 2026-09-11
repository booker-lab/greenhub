import { createHash } from 'node:crypto';
import {
  NOTIFICATION_DELIVERY_PROCESSING_LEASE_TTL_MS,
  NotificationsService,
} from './notifications.service';

type Data = Record<string, unknown>;

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

function deliveryDocId(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey).digest('hex');
}

function deliveryPath(idempotencyKey: string): string {
  return `notificationDeliveries/${deliveryDocId(idempotencyKey)}`;
}

const BASE_NOW = Date.UTC(2026, 8, 11, 0, 0, 0);

function makeHarness(initialNow = BASE_NOW) {
  const records = new Map<string, Data>();
  records.set('users/user-1', { id: 'user-1', phone: '01011112222' });
  records.set('orders/order-1', {
    id: 'order-1',
    storeId: 'store-1',
    userId: 'user-1',
    status: 'DELIVERED',
    deliveryPhone: '01012345678',
  });
  let nowMillis = initialNow;
  let transactionQueue = Promise.resolve();

  function snapshot(path: string, source: Map<string, Data>) {
    const data = source.get(path);
    return {
      exists: data !== undefined,
      data: () => (data === undefined ? undefined : clone(data)),
    };
  }

  function doc(path: string) {
    return {
      path,
      get: jest.fn(async () => snapshot(path, records)),
      set: jest.fn(async (data: Data, options?: { merge?: boolean }) => {
        const current = records.get(path);
        const next =
          options?.merge && current ? { ...clone(current), ...clone(data) } : clone(data);
        records.set(path, next);
      }),
      update: jest.fn(async (data: Data) => {
        const current = records.get(path);
        if (!current) throw new Error(`missing doc: ${path}`);
        records.set(path, { ...clone(current), ...clone(data) });
      }),
    };
  }

  const firestore = {
    doc,
    runTransaction: jest.fn((callback: (tx: any) => Promise<unknown>) => {
      const result = transactionQueue.then(async () => {
        const staged = new Map<string, Data>(
          Array.from(records.entries()).map(([path, data]) => [path, clone(data)]),
        );
        const transaction = {
          get: jest.fn(async (ref: { path: string }) => snapshot(ref.path, staged)),
          set: jest.fn((ref: { path: string }, data: Data, options?: { merge?: boolean }) => {
            const current = staged.get(ref.path);
            const next =
              options?.merge && current
                ? { ...clone(current), ...clone(data) }
                : clone(data);
            staged.set(ref.path, next);
          }),
          update: jest.fn((ref: { path: string }, data: Data) => {
            const current = staged.get(ref.path);
            if (!current) throw new Error(`missing doc: ${ref.path}`);
            staged.set(ref.path, { ...clone(current), ...clone(data) });
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
      now: jest.fn(() => new Date(nowMillis)),
      fromDate: jest.fn((date: Date) => new Date(date.getTime())),
    },
  };

  const aligo = {
    sendAlimtalk: jest.fn().mockResolvedValue({
      success: true,
      channel: 'alimtalk',
      message: 'ok',
      alimtalkAttempts: 1,
      smsAttempts: 0,
    }),
    sendSms: jest.fn(),
  };
  const issueWriter = { createOrMergeIssue: jest.fn(async (issue: Data) => issue) };

  const service = new (NotificationsService as any)(
    firestore,
    aligo,
    {},
    issueWriter,
  ) as NotificationsService;

  return {
    service,
    records,
    firestore,
    aligo,
    readDelivery: (key: string) => clone(records.get(deliveryPath(key))),
    advance: (ms: number) => {
      nowMillis += ms;
    },
    setNow: (ms: number) => {
      nowMillis = ms;
    },
    now: () => nowMillis,
  };
}

function claimInput(key: string) {
  return {
    idempotencyKey: key,
    orderId: 'order-1',
    templateCode: 'ORDER_DELIVERED',
    userId: 'user-1',
  };
}

describe('notification delivery lease foundation', () => {
  it('1: new key acquires exactly one PROCESSING owner', async () => {
    const h = makeHarness();
    const key = 'lease-test-new-1';

    const leaseId = await (h.service as any).claimNotificationDelivery(claimInput(key));

    expect(typeof leaseId).toBe('string');
    const doc = h.readDelivery(key) as Data;
    expect(doc).toMatchObject({ idempotencyKey: key, status: 'PROCESSING', leaseId });
    expect(typeof doc['leaseExpiresAt']).toBe('string');
    expect(doc['attempt']).toBe(1);
    const expiry = new Date(doc['leaseExpiresAt'] as string).getTime();
    expect(expiry).toBe(h.now() + NOTIFICATION_DELIVERY_PROCESSING_LEASE_TTL_MS);
  });

  it('2: two concurrent claims elect exactly one owner', async () => {
    const h = makeHarness();
    const key = 'lease-test-concurrent-1';

    const [first, second] = await Promise.all([
      (h.service as any).claimNotificationDelivery(claimInput(key)),
      (h.service as any).claimNotificationDelivery(claimInput(key)),
    ]);

    const winners = [first, second].filter((value) => typeof value === 'string');
    const losers = [first, second].filter((value) => value === null);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const doc = h.readDelivery(key) as Data;
    expect(doc['leaseId']).toBe(winners[0]);
    expect(doc['status']).toBe('PROCESSING');
  });

  it('3: unexpired PROCESSING gives no dispatch authority to second caller', async () => {
    const h = makeHarness();
    const key = 'lease-test-active-1';

    const first = await (h.service as any).claimNotificationDelivery(claimInput(key));
    expect(typeof first).toBe('string');
    const second = await (h.service as any).claimNotificationDelivery(claimInput(key));
    expect(second).toBeNull();

    h.aligo.sendAlimtalk.mockClear();
    await (h.service as any).sendToUser('user-1', 'ORDER_DELIVERED', { orderId: 'order-1' }, 'order-1', key);
    expect(h.aligo.sendAlimtalk).not.toHaveBeenCalled();
    expect(h.readDelivery(key)).toMatchObject({ status: 'PROCESSING', leaseId: first });
  });

  it('4: expired PROCESSING is reacquired by exactly one caller', async () => {
    const h = makeHarness();
    const key = 'lease-test-expired-1';

    const first = await (h.service as any).claimNotificationDelivery(claimInput(key));
    expect(typeof first).toBe('string');
    h.advance(NOTIFICATION_DELIVERY_PROCESSING_LEASE_TTL_MS + 1);

    const [second, third] = await Promise.all([
      (h.service as any).claimNotificationDelivery(claimInput(key)),
      (h.service as any).claimNotificationDelivery(claimInput(key)),
    ]);
    const winners = [second, third].filter((value) => typeof value === 'string');
    expect(winners).toHaveLength(1);
    expect(winners[0]).not.toBe(first);
    const doc = h.readDelivery(key) as Data;
    expect(doc).toMatchObject({ status: 'PROCESSING', leaseId: winners[0] });
    expect(doc['attempt']).toBe(2);
  });

  it('5: FAILED is retryable with a new attempt', async () => {
    const h = makeHarness();
    const key = 'lease-test-failed-1';

    const first = await (h.service as any).claimNotificationDelivery(claimInput(key));
    await (h.service as any).finishNotificationDelivery(key, 'FAILED', first);
    expect(h.readDelivery(key)).toMatchObject({ status: 'FAILED' });

    const second = await (h.service as any).claimNotificationDelivery(claimInput(key));
    expect(typeof second).toBe('string');
    expect(second).not.toBe(first);
    expect(h.readDelivery(key)).toMatchObject({ status: 'PROCESSING', leaseId: second });
  });

  it('6: SENT never grants retry authority', async () => {
    const h = makeHarness();
    const key = 'lease-test-sent-1';

    const first = await (h.service as any).claimNotificationDelivery(claimInput(key));
    await (h.service as any).finishNotificationDelivery(key, 'SENT', first);
    expect(h.readDelivery(key)).toMatchObject({ status: 'SENT' });

    const second = await (h.service as any).claimNotificationDelivery(claimInput(key));
    expect(second).toBeNull();

    h.aligo.sendAlimtalk.mockClear();
    await (h.service as any).sendToUser('user-1', 'ORDER_DELIVERED', { orderId: 'order-1' }, 'order-1', key);
    expect(h.aligo.sendAlimtalk).not.toHaveBeenCalled();
  });

  it('7: stale owner SENT finish cannot overwrite newer attempt', async () => {
    const h = makeHarness();
    const key = 'lease-test-stale-sent-1';

    const stale = await (h.service as any).claimNotificationDelivery(claimInput(key));
    h.advance(NOTIFICATION_DELIVERY_PROCESSING_LEASE_TTL_MS + 1);
    const current = await (h.service as any).claimNotificationDelivery(claimInput(key));
    expect(current).not.toBe(stale);

    await (h.service as any).finishNotificationDelivery(key, 'SENT', stale);
    expect(h.readDelivery(key)).toMatchObject({ status: 'PROCESSING', leaseId: current });

    await (h.service as any).finishNotificationDelivery(key, 'SENT', current);
    expect(h.readDelivery(key)).toMatchObject({ status: 'SENT', leaseId: current });
  });

  it('8: stale owner FAILED finish cannot overwrite newer attempt', async () => {
    const h = makeHarness();
    const key = 'lease-test-stale-failed-1';

    const stale = await (h.service as any).claimNotificationDelivery(claimInput(key));
    h.advance(NOTIFICATION_DELIVERY_PROCESSING_LEASE_TTL_MS + 1);
    const current = await (h.service as any).claimNotificationDelivery(claimInput(key));

    await (h.service as any).finishNotificationDelivery(key, 'FAILED', stale);
    expect(h.readDelivery(key)).toMatchObject({ status: 'PROCESSING', leaseId: current });

    await (h.service as any).finishNotificationDelivery(key, 'FAILED', current);
    expect(h.readDelivery(key)).toMatchObject({ status: 'FAILED', leaseId: current });
  });

  it('9: active owner SENT finish reaches terminal', async () => {
    const h = makeHarness();
    const key = 'lease-test-finish-sent-1';

    const leaseId = await (h.service as any).claimNotificationDelivery(claimInput(key));
    await (h.service as any).finishNotificationDelivery(key, 'SENT', leaseId);

    const doc = h.readDelivery(key) as Data;
    expect(doc).toMatchObject({ status: 'SENT', leaseId });
    expect(doc['completedAt']).not.toBeNull();

    const retry = await (h.service as any).claimNotificationDelivery(claimInput(key));
    expect(retry).toBeNull();
  });

  it('10: active owner FAILED finish stays retryable', async () => {
    const h = makeHarness();
    const key = 'lease-test-finish-failed-1';

    const leaseId = await (h.service as any).claimNotificationDelivery(claimInput(key));
    await (h.service as any).finishNotificationDelivery(key, 'FAILED', leaseId);

    const doc = h.readDelivery(key) as Data;
    expect(doc).toMatchObject({ status: 'FAILED', leaseId });
    expect(doc['completedAt']).toBeNull();

    const retry = await (h.service as any).claimNotificationDelivery(claimInput(key));
    expect(typeof retry).toBe('string');
    expect(retry).not.toBe(leaseId);
  });

  it('existing consumer-cancel key still dispatches exactly once', async () => {
    const h = makeHarness();
    const key = 'consumer-cancel:order-1';

    await (h.service as any).sendToUser(
      'user-1',
      'GROUP_CANCELLED_SELF',
      { orderId: 'order-1', productId: 'product-1' },
      'order-1',
      key,
    );
    await (h.service as any).sendToUser(
      'user-1',
      'GROUP_CANCELLED_SELF',
      { orderId: 'order-1', productId: 'product-1' },
      'order-1',
      key,
    );

    expect(h.aligo.sendAlimtalk).toHaveBeenCalledTimes(1);
    expect(h.readDelivery(key)).toMatchObject({ status: 'SENT', idempotencyKey: key });
  });

  it('existing delivery-completion key still dispatches exactly once', async () => {
    const h = makeHarness();
    const key = 'order-transition:order-1:DELIVERING:DELIVERED';

    await (h.service as any).sendToUser(
      'user-1',
      'ORDER_DELIVERED',
      { orderId: 'order-1' },
      'order-1',
      key,
    );
    await (h.service as any).sendToUser(
      'user-1',
      'ORDER_DELIVERED',
      { orderId: 'order-1' },
      'order-1',
      key,
    );

    expect(h.aligo.sendAlimtalk).toHaveBeenCalledTimes(1);
    expect(h.readDelivery(key)).toMatchObject({ status: 'SENT', idempotencyKey: key });
  });
});
