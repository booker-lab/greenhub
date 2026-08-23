import { PaymentFinalizationService } from './payment-finalization.service';
import { PaymentRefundService } from './payment-refund.service';
import { RoundOrderLifecycleService } from '../orders/round-order-lifecycle.service';

type Data = Record<string, any>;

function makeSnap(data: Data | null, ref?: Data) {
  return { exists: data !== null, data: () => data, ref };
}

function makeFirestore(initial: Record<string, Data>) {
  const records = new Map(Object.entries(initial));
  const refs = new Map<string, Data>();
  const doc = (path: string) => {
    if (!refs.has(path)) {
      refs.set(path, {
        path,
        get: jest.fn(async () => makeSnap(records.get(path) ?? null, refs.get(path))),
        set: jest.fn(async (data: Data) => records.set(path, data)),
        update: jest.fn(async (data: Data) =>
          records.set(path, { ...(records.get(path) ?? {}), ...data }),
        ),
      });
    }
    return refs.get(path);
  };
  const collection = (name: string) => {
    const filters: Array<[string, string, unknown]> = [];
    const query: Data = {
      where(field: string, op: string, value: unknown) {
        filters.push([field, op, value]);
        return query;
      },
      limit() {
        return query;
      },
      async get() {
        const docs = Array.from(records.entries())
          .filter(([path, data]) => {
            if (!path.startsWith(`${name}/`)) return false;
            return filters.every(([field, op, value]) =>
              op === '<' ? true : data[field] === value,
            );
          })
          .map(([path, data]) => ({ id: path.split('/')[1], data: () => data, ref: doc(path) }));
        return { empty: docs.length === 0, docs };
      },
    };
    return query;
  };

  let transactionQueue = Promise.resolve();
  const firestore = {
    doc,
    collection,
    runTransaction: jest.fn((callback: (tx: Data) => Promise<unknown>) => {
      const result = transactionQueue.then(async () => {
        const pending = new Map<string, Data>();
        const tx = {
          get: jest.fn(async (ref: Data) =>
            makeSnap(pending.get(ref.path) ?? records.get(ref.path) ?? null, ref),
          ),
          set: jest.fn((ref: Data, data: Data) => pending.set(ref.path, data)),
          update: jest.fn((ref: Data, data: Data) => {
            const current = pending.get(ref.path) ?? records.get(ref.path) ?? {};
            pending.set(ref.path, { ...current, ...data });
          }),
        };
        const value = await callback(tx);
        for (const [path, data] of pending) records.set(path, data);
        return value;
      });
      transactionQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }),
    Timestamp: {
      now: jest.fn(() => new Date('2026-08-23T00:00:00.000Z')),
    },
    FieldValue: {
      increment: jest.fn((value: number) => ({ __increment: value })),
    },
  };
  return { firestore, records };
}

function makeOrder(overrides: Data = {}) {
  return {
    id: 'order-1',
    storeId: 'store-1',
    userId: 'user-1',
    status: 'PENDING',
    schemaVersion: 2,
    roundId: 'round-1',
    reservationId: 'reservation-1',
    saleType: 'normal',
    totalAmount: 100000,
    deliveryAddress: { address: '경기도 이천시 중리천로 1' },
    orderItems: [{ roundItemId: 'round-item-1', quantity: 1 }],
    ...overrides,
  };
}

function makeFixture(orderOverrides: Data = {}) {
  const { firestore, records } = makeFirestore({
    'orders/order-1': makeOrder(orderOverrides),
    'saleRounds/round-1': {
      storeId: 'store-1',
      schedule: { orderCloseAt: '2099-08-23T00:00:00.000Z' },
    },
  });
  const portone = { refund: jest.fn().mockResolvedValue(undefined) };
  const issueWriter = { createOrMergeIssue: jest.fn().mockResolvedValue({ id: 'issue-1' }) };
  const retention = { saveRecord: jest.fn().mockResolvedValue({}) };
  const refunds = new PaymentRefundService(
    firestore as never,
    portone as never,
    issueWriter as never,
    retention as never,
  );
  const capacity = {
    reserveCheckout: jest.fn().mockResolvedValue({ id: 'late-reservation-1' }),
    consumeReservationInTransaction: jest.fn().mockResolvedValue({ status: 'CONSUMED' }),
    releaseReservationInTransaction: jest.fn().mockResolvedValue({ status: 'RELEASED' }),
  };
  const notifications = { sendToUser: jest.fn() };
  const finalization = new PaymentFinalizationService(
    firestore as never,
    portone as never,
    notifications as never,
    { log: jest.fn() } as never,
    capacity as never,
    issueWriter as never,
    retention as never,
    refunds,
  );
  const payments = {
    processRefundByOrderId: jest.fn((orderId: string, reason: string) =>
      refunds.refundByOrderId(orderId, reason),
    ),
    refundOrderChargesByOrderId: jest.fn().mockResolvedValue(undefined),
  };
  const settlements = { cancelSettlement: jest.fn().mockResolvedValue(undefined) };
  const lifecycle = new RoundOrderLifecycleService(
    firestore as never,
    payments as never,
    settlements as never,
    capacity as never,
  );
  return { firestore, records, portone, payments, finalization, lifecycle };
}

const paidPayment = {
  amount: { total: 100000 },
  status: 'PAID',
  method: { type: 'CARD' },
  transactionId: 'tx-1',
} as never;

describe('P0-002 회차 취소와 결제 finalization 경합', () => {
  it('cancel first: 완료된 취소 뒤 늦은 PAID를 기존 환불 경로로 수렴시킨다', async () => {
    const fixture = makeFixture();

    await fixture.lifecycle.cancelByConsumer({
      storeId: 'store-1',
      orderId: 'order-1',
      userId: 'user-1',
      reason: '소비자 취소',
    });
    const result = await fixture.finalization.finalizePaidOrder('order-1', paidPayment);

    expect(result).toEqual({ ok: false, reason: 'cancelled_paid_refunded' });
    expect(fixture.records.get('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
    expect(fixture.records.get('payments/order-1')).toMatchObject({
      status: 'CANCELLED',
      refundAmount: 100000,
    });
    expect(fixture.portone.refund).toHaveBeenCalledTimes(1);
  });

  it('payment first: 취소 요청이 시작된 뒤 결제 확정이 먼저 커밋되어도 최신 상태로 환불 취소한다', async () => {
    const fixture = makeFixture();
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const readStarted = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const orderRef = (fixture.firestore as any).doc('orders/order-1');
    const originalGet = orderRef.get;
    let firstRead = true;
    orderRef.get = jest.fn(async () => {
      const snapshot = await originalGet();
      if (firstRead) {
        firstRead = false;
        reached();
        await gate;
      }
      return snapshot;
    });

    const cancellation = fixture.lifecycle.cancelByConsumer({
      storeId: 'store-1',
      orderId: 'order-1',
      userId: 'user-1',
      reason: '소비자 취소',
    });
    await readStarted;

    await expect(fixture.finalization.finalizePaidOrder('order-1', paidPayment)).resolves.toEqual({
      ok: true,
      status: 'ACCEPTED',
    });
    expect(fixture.records.get('orders/order-1')?.status).toBe('ACCEPTED');

    release();
    await cancellation;

    expect(fixture.records.get('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
    expect(fixture.records.get('payments/order-1')).toMatchObject({ status: 'CANCELLED' });
    expect(fixture.portone.refund).toHaveBeenCalledTimes(1);
  });

  it('cancellation claim first: PAID가 기록되어도 로컬 취소가 최신 결제를 다시 확인한다', async () => {
    const fixture = makeFixture();
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const applyStarted = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const originalApply = (fixture.lifecycle as any).applyLocalCancellation.bind(fixture.lifecycle);
    (fixture.lifecycle as any).applyLocalCancellation = async (input: Data) => {
      reached();
      await gate;
      return originalApply(input);
    };

    const cancellation = fixture.lifecycle.cancelByConsumer({
      storeId: 'store-1',
      orderId: 'order-1',
      userId: 'user-1',
      reason: '소비자 취소',
    });
    await applyStarted;

    await expect(fixture.finalization.finalizePaidOrder('order-1', paidPayment)).resolves.toEqual({
      ok: false,
      reason: 'cancelled_paid_refunded',
    });
    expect(fixture.records.get('orders/order-1')?.status).toBe('PENDING');
    expect(fixture.records.get('payments/order-1')?.status).toBe('CANCELLED');

    release();
    await cancellation;

    expect(fixture.records.get('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
    expect(fixture.records.get('payments/order-1')).toMatchObject({ status: 'CANCELLED' });
    expect(fixture.portone.refund).toHaveBeenCalledTimes(1);
  });

  it('cancellation claim exists: 진행 중 취소는 정상 ACCEPTED 전환을 차단한다', async () => {
    const fixture = makeFixture({
      cancellation: { status: 'LOCAL_PENDING', reason: '소비자 취소' },
    });

    const result = await fixture.finalization.finalizePaidOrder('order-1', paidPayment);

    expect(result).toEqual({ ok: false, reason: 'cancelled_paid_refunded' });
    expect(fixture.records.get('orders/order-1')?.status).toBe('PENDING');
    expect(fixture.records.get('payments/order-1')?.status).toBe('CANCELLED');
    expect(fixture.portone.refund).toHaveBeenCalledTimes(1);
  });

  it('취소 후 확인된 결제의 환불 실패는 정상 취소 완료로 숨기지 않는다', async () => {
    const fixture = makeFixture({
      status: 'CANCELLED',
      cancelReason: '소비자 취소',
      cancellation: { status: 'COMPLETED', reason: '소비자 취소' },
    });
    fixture.portone.refund.mockRejectedValueOnce(new Error('환불 실패'));

    await expect(fixture.finalization.finalizePaidOrder('order-1', paidPayment)).rejects.toThrow(
      '환불 실패',
    );
    expect(fixture.records.get('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'REFUND_FAILED' },
    });
    expect(fixture.records.get('payments/order-1')).toMatchObject({
      status: 'PAID',
      refundClaim: null,
    });
  });

  it('normal payment: 취소 claim이 없는 PAID는 기존 ACCEPTED 전환을 유지한다', async () => {
    const fixture = makeFixture();

    const result = await fixture.finalization.finalizePaidOrder('order-1', paidPayment);

    expect(result).toEqual({ ok: true, status: 'ACCEPTED' });
    expect(fixture.records.get('orders/order-1')?.status).toBe('ACCEPTED');
    expect(fixture.records.get('payments/order-1')?.status).toBe('PAID');
    expect(fixture.portone.refund).not.toHaveBeenCalled();
  });

  it('normal unpaid cancellation: 결제 기록이 없으면 PortOne 환불 없이 취소한다', async () => {
    const fixture = makeFixture();

    await fixture.lifecycle.cancelByConsumer({
      storeId: 'store-1',
      orderId: 'order-1',
      userId: 'user-1',
      reason: '소비자 취소',
    });

    expect(fixture.records.get('orders/order-1')?.status).toBe('CANCELLED');
    expect(fixture.records.has('payments/order-1')).toBe(false);
    expect(fixture.portone.refund).not.toHaveBeenCalled();
    expect(fixture.payments.processRefundByOrderId).not.toHaveBeenCalled();
  });
});
