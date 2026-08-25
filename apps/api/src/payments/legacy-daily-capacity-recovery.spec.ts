import { OrdersLifecycleService } from '../orders/orders-lifecycle.service';
import {
  isLegacyDailyCapacityEligible,
  legacyDailyCapacityDateKey,
} from './_lib/legacy-daily-capacity';
import { PaymentFinalizationService } from './payment-finalization.service';
import { PaymentsService } from './payments.service';

type Data = Record<string, any>;

function makeSnap(data: Data | null, ref?: Data) {
  return { exists: data !== null, data: () => data, ref };
}

function makeFirestore(initial: Record<string, Data>) {
  const records = new Map(Object.entries(initial));
  const refs = new Map<string, Data>();
  const doc = jest.fn((path: string) => {
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
  });

  let transactionQueue = Promise.resolve();
  const firestore = {
    doc,
    collection: jest.fn(),
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
      now: jest.fn(() => new Date('2026-08-25T00:00:00.000Z')),
      fromDate: jest.fn((date: Date) => date),
    },
    FieldValue: {
      increment: jest.fn((value: number) => ({ __increment: value })),
    },
  };
  return { firestore, records };
}

function makeLegacyOrder(overrides: Data = {}) {
  return {
    id: 'order-1',
    storeId: 'store-1',
    userId: 'user-1',
    status: 'PENDING',
    schemaVersion: 1,
    saleType: 'normal',
    deliveryMethod: 'direct',
    quantity: 2,
    requestedDeliveryDate: '2026-08-25',
    createdAt: new Date('2026-08-24T23:00:00.000Z'),
    totalAmount: 100000,
    ...overrides,
  };
}

function makeFinalization(orderOverrides: Data = {}, capOverrides: Data = {}) {
  const order = makeLegacyOrder(orderOverrides);
  const { firestore, records } = makeFirestore({
    'orders/order-1': order,
    'dailyCaps/store-1_2026-08-25': {
      storeId: 'store-1',
      date: '2026-08-25',
      totalCap: 10,
      usedSlots: 2,
      ...capOverrides,
    },
  });
  const portone = { refund: jest.fn().mockResolvedValue(undefined) };
  const capacity = {
    consumeReservationInTransaction: jest.fn(),
    releaseReservationInTransaction: jest.fn(),
    reserveCheckout: jest.fn(),
  };
  const service = new PaymentFinalizationService(
    firestore as never,
    portone as never,
    { sendToUser: jest.fn() } as never,
    { log: jest.fn() } as never,
    capacity as never,
    { createOrMergeIssue: jest.fn() } as never,
    { saveRecord: jest.fn().mockResolvedValue(undefined) } as never,
    { refundByOrderId: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { firestore, records, portone, capacity, service };
}

const paidPayment = {
  amount: { total: 100000 },
  status: 'PAID',
  method: { type: 'CARD' },
  transactionId: 'tx-1',
} as never;

describe('legacy daily capacity 정책', () => {
  it.each([
    ['normal direct', { saleType: 'normal', deliveryMethod: 'direct' }, true],
    ['normal hub', { saleType: 'normal', deliveryMethod: 'hub' }, true],
    ['normal parcel', { saleType: 'normal', deliveryMethod: 'parcel' }, false],
    ['group direct', { saleType: 'group', deliveryMethod: 'direct' }, false],
    ['group hub', { saleType: 'group', deliveryMethod: 'hub' }, false],
    ['group parcel', { saleType: 'group', deliveryMethod: 'parcel' }, false],
    ['round v2 direct', { schemaVersion: 2, deliveryMethod: 'direct' }, false],
  ])('%s eligibility를 명시적으로 판정한다', (_name, overrides, expected) => {
    expect(isLegacyDailyCapacityEligible(makeLegacyOrder(overrides))).toBe(expected);
  });

  it('requestedDeliveryDate를 우선 사용하고 없으면 createdAt을 KST로 변환한다', () => {
    expect(
      legacyDailyCapacityDateKey(
        makeLegacyOrder({
          requestedDeliveryDate: '2026-08-26',
          createdAt: new Date('2026-08-25T15:00:00.000Z'),
        }),
      ),
    ).toBe('2026-08-26');
    expect(
      legacyDailyCapacityDateKey(
        makeLegacyOrder({ requestedDeliveryDate: null, createdAt: new Date('2026-08-25T15:00:00.000Z') }),
      ),
    ).toBe('2026-08-26');
  });

  it.each(['payment_failed', 'timeout'])(
    '%s cancellation은 eligible legacy capacity를 한 번만 반환한다',
    async (reason) => {
      const fixture = makeFinalization();

      await fixture.service.cancelPendingOrder('order-1', reason);
      await fixture.service.cancelPendingOrder('order-1', reason);

      expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.['usedSlots']).toBe(0);
      expect(fixture.records.get('orders/order-1')).toMatchObject({
        status: 'CANCELLED',
        legacyDailyCapacity: { status: 'RELEASED', quantity: 2 },
      });
    },
  );

  it('payment failure webhook은 실제 finalization recovery를 호출한다', async () => {
    const fixture = makeFinalization();
    const service = new PaymentsService(
      fixture.firestore as never,
      {} as never,
      fixture.service,
      {} as never,
      { isOrderChargePaymentId: jest.fn().mockReturnValue(false) } as never,
    );

    await service.handleWebhook({
      type: 'Transaction.Failed',
      data: { paymentId: 'order-1' },
    } as never);

    expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.['usedSlots']).toBe(0);
    expect(fixture.records.get('orders/order-1')?.['status']).toBe('CANCELLED');
  });

  it.each([
    ['normal parcel', { saleType: 'normal', deliveryMethod: 'parcel' }],
    ['group direct', { saleType: 'group', deliveryMethod: 'direct' }],
    ['group hub', { saleType: 'group', deliveryMethod: 'hub' }],
    ['round v2 direct', { schemaVersion: 2, deliveryMethod: 'direct', reservationId: 'reservation-1' }],
  ])('%s cancellation은 legacy daily cap을 변경하지 않는다', async (_name, overrides) => {
    const fixture = makeFinalization(overrides);

    await fixture.service.cancelPendingOrder('order-1', 'timeout');

    expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.['usedSlots']).toBe(2);
    expect(fixture.records.get('orders/order-1')?.['legacyDailyCapacity']).toBeUndefined();
  });

  it('점유량보다 큰 반환은 clamp하지 않고 transaction을 실패시켜 음수화를 막는다', async () => {
    const fixture = makeFinalization({}, { usedSlots: 1 });

    await expect(fixture.service.cancelPendingOrder('order-1', 'timeout')).rejects.toThrow(
      '점유 상태가 이미 반환되었거나 손상되었습니다',
    );

    expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.['usedSlots']).toBe(1);
    expect(fixture.records.get('orders/order-1')?.['status']).toBe('PENDING');
  });

  it('timeout 뒤 late PAID는 capacity를 transaction 안에서 재확보한 뒤 ACCEPTED로 확정한다', async () => {
    const fixture = makeFinalization(
      {
        status: 'CANCELLED',
        cancelReason: 'timeout',
        legacyDailyCapacity: {
          status: 'RELEASED',
          date: '2026-08-25',
          quantity: 2,
        },
      },
      { usedSlots: 0 },
    );

    await expect(fixture.service.finalizePaidOrder('order-1', paidPayment)).resolves.toEqual({
      ok: true,
      status: 'ACCEPTED',
    });

    expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.['usedSlots']).toBe(2);
    expect(fixture.records.get('orders/order-1')).toMatchObject({
      status: 'ACCEPTED',
      legacyDailyCapacity: { status: 'HELD', quantity: 2 },
    });
  });

  it('late PAID capacity 재확보 실패는 ACCEPTED 확정 없이 환불 상태로 수렴한다', async () => {
    const fixture = makeFinalization(
      {
        status: 'CANCELLED',
        cancelReason: 'timeout',
        legacyDailyCapacity: {
          status: 'RELEASED',
          date: '2026-08-25',
          quantity: 2,
        },
      },
      { usedSlots: 10 },
    );

    await expect(fixture.service.finalizePaidOrder('order-1', paidPayment)).resolves.toEqual({
      ok: false,
      reason: 'late_payment_refunded',
    });

    expect(fixture.portone.refund).toHaveBeenCalledTimes(1);
    expect(fixture.records.get('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      latePaymentRefundedAt: expect.anything(),
    });
    expect(fixture.records.get('payments/order-1')).toMatchObject({ status: 'CANCELLED' });
    expect(fixture.records.get('dailyCaps/store-1_2026-08-25')?.['usedSlots']).toBe(10);
  });
});

describe('legacy seller cancellation recovery', () => {
  it.each(['direct', 'hub'])(
    'seller cancellation은 normal %s capacity를 한 번만 반환한다',
    async (deliveryMethod) => {
      const order = makeLegacyOrder({ status: 'ACCEPTED', deliveryMethod });
      const { firestore, records } = makeFirestore({
        'orders/order-1': order,
        'stores/store-1': { ownerId: 'seller-1' },
        'dailyCaps/store-1_2026-08-25': {
          storeId: 'store-1',
          date: '2026-08-25',
          totalCap: 10,
          usedSlots: 2,
        },
      });
      const payments = { processRefundByOrderId: jest.fn().mockResolvedValue(undefined) };
      const settlements = { cancelSettlement: jest.fn().mockResolvedValue(undefined) };
      const service = new OrdersLifecycleService(
        firestore as never,
        { sendToUser: jest.fn(), sendToGroupParticipants: jest.fn() } as never,
        payments as never,
        settlements as never,
        {} as never,
        {} as never,
      );

      await service.updateStatus(
        'store-1',
        'order-1',
        'seller-1',
        { status: 'CANCELLED', reason: '재고 부족' } as never,
        'seller',
      );

      expect(records.get('dailyCaps/store-1_2026-08-25')?.['usedSlots']).toBe(0);
      expect(records.get('orders/order-1')).toMatchObject({
        status: 'CANCELLED',
        legacyDailyCapacity: { status: 'RELEASED', quantity: 2 },
      });

      await expect(
        service.updateStatus(
          'store-1',
          'order-1',
          'seller-1',
          { status: 'CANCELLED', reason: '재고 부족' } as never,
          'seller',
        ),
      ).rejects.toThrow();
      expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
      expect(records.get('dailyCaps/store-1_2026-08-25')?.['usedSlots']).toBe(0);
    },
  );
});
