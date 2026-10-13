import { ConflictException, ForbiddenException } from '@nestjs/common';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { OrderCapacityService } from './order-capacity.service';
import { OrdersLifecycleService } from './orders-lifecycle.service';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';

// legacy 주문(schemaVersion 2 + roundId가 아닌 주문)은 RoundOrderLifecycleService로 위임되지 않고
// OrdersLifecycleService.updateStatus의 legacy 분기에서 전이된다. 이 spec은 그 분기에서
// 판매자 DELIVERY_HELD → PREPARING 이후의 배송 재개가 유료 재배송 결제 게이트를 따르는지 직접 고정한다.

type Data = Record<string, any>;

const holdAt = '2026-08-26T00:00:00.000Z';
const previousHoldAt = '2026-08-01T00:00:00.000Z';

type Variant = { label: string; roundId: string | null };

const variants: Variant[] = [
  { label: 'roundId 없는 legacy 주문', roundId: null },
  { label: 'roundId가 남아 있는 legacy 주문', roundId: 'round-1' },
];

const paidHold: Data = {
  heldAt: holdAt,
  reasonCode: 'ACCESS_UNAVAILABLE',
  reasonMessage: '배송지 출입 불가',
  customerResponsible: true,
  redeliveryFee: 5_000,
  nextContactAt: null,
  nextDeliveryAt: null,
  resolvedAt: null,
};

const unpaidChargeCases: Array<[string, ContextOptions]> = [
  ['PENDING charge', { chargeStatus: 'PENDING' }],
  ['FAILED charge', { chargeStatus: 'FAILED' }],
  ['REFUNDED charge', { chargeStatus: 'REFUNDED' }],
  [
    'charge 연결 없음',
    {
      omitCharge: true,
      orderOverrides: { redeliveryChargeId: null, redeliveryChargeHoldAt: null },
    },
  ],
  ['연결된 charge 문서 없음', { omitCharge: true }],
  [
    '이전 hold에 연결된 PAID charge',
    {
      chargeStatus: 'PAID',
      chargeOverrides: { holdAt: previousHoldAt },
      orderOverrides: { redeliveryChargeHoldAt: previousHoldAt },
    },
  ],
  ['금액이 다른 PAID charge', { chargeStatus: 'PAID', chargeOverrides: { amount: 3_000 } }],
];

type ContextOptions = {
  status?: 'DELIVERY_HELD' | 'PREPARING';
  chargeStatus?: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  omitCharge?: boolean;
  chargeOverrides?: Data;
  orderOverrides?: Data;
};

function makeContext(variant: Variant, options: ContextOptions = {}) {
  const order: Data = {
    id: 'order-1',
    schemaVersion: 1,
    roundId: variant.roundId,
    saleType: 'normal',
    storeId: 'store-1',
    userId: 'consumer-1',
    driverId: 'driver-1',
    status: options.status ?? 'DELIVERY_HELD',
    deliveryMethod: 'direct',
    deliveryHold: { ...paidHold },
    redeliveryChargeId: 'charge-1',
    redeliveryChargeHoldAt: holdAt,
    ...options.orderOverrides,
  };
  const records: Record<string, Data> = {
    'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
    'saleRounds/round-1': {
      id: 'round-1',
      storeId: 'store-1',
      counters: {
        reservedDeliveryAddresses: 0,
        reservedItemQuantity: 0,
        orderedDeliveryAddresses: 0,
        orderedItemQuantity: 0,
        heldOrderCount: 1,
      },
    },
    'orders/order-1': order,
  };
  if (!options.omitCharge) {
    records['orderCharges/charge-1'] = {
      id: 'charge-1',
      orderId: 'order-1',
      storeId: 'store-1',
      userId: 'consumer-1',
      type: 'REDELIVERY_FEE',
      status: options.chargeStatus ?? 'PENDING',
      amount: 5_000,
      customerResponsible: true,
      holdAt,
      portonePaymentId: 'order-charge-charge-1',
      ...options.chargeOverrides,
    };
  }

  const memory = createInMemoryFirestore(records);
  const firestore = memory.firestore as never;
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
  const capacity = new OrderCapacityService(firestore);
  const roundLifecycle = new RoundOrderLifecycleService(
    firestore,
    payments as never,
    settlements as never,
    capacity as never,
  );
  const roundUpdateStatus = jest.spyOn(roundLifecycle, 'updateStatus');
  const lifecycle = new OrdersLifecycleService(
    firestore,
    notifications as never,
    payments as never,
    settlements as never,
    capacity as never,
    roundLifecycle,
  );

  return { memory, lifecycle, notifications, roundUpdateStatus };
}

type Context = ReturnType<typeof makeContext>;

function transition(
  context: Context,
  status: 'PREPARING' | 'DELIVERING',
  requester: { id: string; role: 'seller' | 'driver' | 'admin' },
) {
  return context.lifecycle.updateStatus(
    'store-1',
    'order-1',
    requester.id,
    { status } as never,
    requester.role,
  );
}

const seller = { id: 'seller-1', role: 'seller' } as const;
const driver = { id: 'driver-1', role: 'driver' } as const;
const admin = { id: 'admin-1', role: 'admin' } as const;

function heldOrderCount(context: Context) {
  return context.memory.read('saleRounds/round-1')?.counters.heldOrderCount;
}

// 해소 시점에만 회차 보류 건수가 1 줄어든다. roundId가 없는 legacy 주문은 회차 counter를 건드리지 않는다.
function expectedHeldCount(variant: Variant, resolved: boolean) {
  return variant.roundId && resolved ? 0 : 1;
}

function snapshot(context: Context) {
  return {
    order: context.memory.read('orders/order-1'),
    round: context.memory.read('saleRounds/round-1'),
    charge: context.memory.read('orderCharges/charge-1'),
    notifications: context.notifications.sendToUser.mock.calls.length,
  };
}

function expectUnchanged(context: Context, before: ReturnType<typeof snapshot>) {
  expect(snapshot(context)).toEqual(before);
}

describe.each(variants)('legacy 판매자 경로 유료 재배송 결제 게이트 — $label', (variant) => {
  it('고객 책임·양수 재배송비 hold의 판매자 HELD → PREPARING은 결제 의무·연결·counter를 유지하고 결제 요청을 보낸다', async () => {
    const context = makeContext(variant, { chargeStatus: 'PENDING' });

    await expect(transition(context, 'PREPARING', seller)).resolves.toEqual({
      orderId: 'order-1',
      status: 'PREPARING',
    });

    expect(context.roundUpdateStatus).not.toHaveBeenCalled();
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'PREPARING',
      redeliveryChargeId: 'charge-1',
      redeliveryChargeHoldAt: holdAt,
      deliveryHold: {
        heldAt: holdAt,
        customerResponsible: true,
        redeliveryFee: 5_000,
        resolvedAt: null,
      },
    });
    expect(heldOrderCount(context)).toBe(expectedHeldCount(variant, false));
    expect(context.notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(context.notifications.sendToUser).toHaveBeenCalledWith(
      'consumer-1',
      'ORDER_REDELIVERY_PAYMENT_REQUESTED',
      { orderId: 'order-1' },
      'order-1',
      undefined,
    );
  });

  it('판매자는 DELIVERY_HELD에서 직접 배송을 재개할 수 없다', async () => {
    const context = makeContext(variant, { chargeStatus: 'PAID' });
    const before = snapshot(context);

    await expect(transition(context, 'DELIVERING', seller)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expectUnchanged(context, before);
  });

  // 관리자 재개는 현재 주문 생성 경로가 만드는 legacy 형태(roundId 없음)에서만 고정한다.
  const resumeRequesters: Array<[string, typeof driver | typeof admin]> = variant.roundId
    ? [['기사', driver]]
    : [
        ['기사', driver],
        ['관리자', admin],
      ];

  describe.each(resumeRequesters)('%s의 PREPARING → DELIVERING 재개', (_label, requester) => {
    it.each(
      unpaidChargeCases,
    )('%s이면 판매자 PREPARING 전환 뒤에도 side effect 없이 거부한다', async (_case, options) => {
      const context = makeContext(variant, options);
      await expect(transition(context, 'PREPARING', seller)).resolves.toMatchObject({
        status: 'PREPARING',
      });
      const before = snapshot(context);

      await expect(transition(context, 'DELIVERING', requester)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expectUnchanged(context, before);
      expect(context.memory.read('orders/order-1')?.deliveryHold).toMatchObject({
        resolvedAt: null,
      });
      expect(heldOrderCount(context)).toBe(expectedHeldCount(variant, false));
    });

    it('현재 hold의 charge가 PAID가 된 뒤에만 한 번 재개하고 hold 해소·counter 감소를 한 번 처리한다', async () => {
      const context = makeContext(variant, { chargeStatus: 'PENDING' });
      await transition(context, 'PREPARING', seller);

      const beforeUnpaid = snapshot(context);
      await expect(transition(context, 'DELIVERING', requester)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expectUnchanged(context, beforeUnpaid);

      await context.memory.firestore.doc('orderCharges/charge-1').update({ status: 'PAID' });

      await expect(transition(context, 'DELIVERING', requester)).resolves.toEqual({
        orderId: 'order-1',
        status: 'DELIVERING',
      });
      expect(context.roundUpdateStatus).not.toHaveBeenCalled();
      expect(context.memory.read('orders/order-1')).toMatchObject({
        status: 'DELIVERING',
        driverId: requester.id,
        deliveryHold: { heldAt: holdAt, resolvedAt: expect.any(String) },
      });
      expect(heldOrderCount(context)).toBe(expectedHeldCount(variant, true));
      expect(context.notifications.sendToUser).toHaveBeenLastCalledWith(
        'consumer-1',
        'ORDER_REDELIVERY_SCHEDULED',
        { orderId: 'order-1' },
        'order-1',
        undefined,
      );
      expect(context.notifications.sendToUser).toHaveBeenCalledTimes(2);

      const afterResume = snapshot(context);
      await expect(transition(context, 'DELIVERING', requester)).rejects.toBeDefined();
      expectUnchanged(context, afterResume);
    });
  });

  describe('기사의 DELIVERY_HELD → DELIVERING 직접 재개', () => {
    it.each(unpaidChargeCases)('%s이면 side effect 없이 거부한다', async (_case, options) => {
      const context = makeContext(variant, options);
      const before = snapshot(context);

      await expect(transition(context, 'DELIVERING', driver)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expectUnchanged(context, before);
    });

    it('현재 hold에 연결된 PAID charge면 재개하고 hold 해소·counter 감소를 한 번 처리한다', async () => {
      const context = makeContext(variant, { chargeStatus: 'PAID' });

      await expect(transition(context, 'DELIVERING', driver)).resolves.toEqual({
        orderId: 'order-1',
        status: 'DELIVERING',
      });
      expect(context.memory.read('orders/order-1')).toMatchObject({
        status: 'DELIVERING',
        deliveryHold: { heldAt: holdAt, resolvedAt: expect.any(String) },
      });
      expect(heldOrderCount(context)).toBe(expectedHeldCount(variant, true));
      expect(context.notifications.sendToUser).toHaveBeenCalledTimes(1);
      expect(context.notifications.sendToUser).toHaveBeenCalledWith(
        'consumer-1',
        'ORDER_REDELIVERY_SCHEDULED',
        { orderId: 'order-1' },
        'order-1',
        undefined,
      );

      const afterResume = snapshot(context);
      await expect(transition(context, 'DELIVERING', driver)).rejects.toBeDefined();
      expectUnchanged(context, afterResume);
    });
  });

  it.each([
    [
      '판매자 책임',
      {
        ...paidHold,
        reasonCode: 'OTHER',
        reasonMessage: '판매자 배송 처리 지연',
        customerResponsible: false,
        redeliveryFee: null,
      },
    ],
    ['고객 책임이지만 재배송비 0원', { ...paidHold, redeliveryFee: 0 }],
  ])('%s hold는 판매자 PREPARING 전환에서 해소되고 결제 없이 배송을 재개한다', async (_label, deliveryHold) => {
    const context = makeContext(variant, {
      omitCharge: true,
      orderOverrides: { deliveryHold, redeliveryChargeId: null, redeliveryChargeHoldAt: null },
    });

    await expect(transition(context, 'PREPARING', seller)).resolves.toMatchObject({
      status: 'PREPARING',
    });
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'PREPARING',
      deliveryHold: { heldAt: holdAt, resolvedAt: expect.any(String) },
    });
    expect(heldOrderCount(context)).toBe(expectedHeldCount(variant, true));
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();

    const resolvedAt = context.memory.read('orders/order-1')?.deliveryHold.resolvedAt;
    await expect(transition(context, 'DELIVERING', driver)).resolves.toMatchObject({
      status: 'DELIVERING',
    });
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'DELIVERING',
      deliveryHold: { resolvedAt },
    });
    expect(heldOrderCount(context)).toBe(expectedHeldCount(variant, true));
    expect(context.notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(context.notifications.sendToUser).toHaveBeenCalledWith(
      'consumer-1',
      'ORDER_DELIVERING',
      { orderId: 'order-1' },
      'order-1',
      undefined,
    );
  });
});
