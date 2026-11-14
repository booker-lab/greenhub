// 고객 사유 종결(환불 없음) 회귀 — 판정표·보류 집계·정산·재시도·뒤늦은 재배송비 결제·회차 완료/취소.
// 가짜 Firestore(OCC 하네스)로 실제 CustomerFaultClosureService·OrderCapacityService·SettlementsService를 구동한다.

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { OrderChargePaymentService } from '../payments/order-charge-payment.service';
import { PortoneError } from '../payments/portone.client';
import { SaleRoundStateService } from '../sale-rounds/sale-round-state.service';
import { readOrderPayoutHoldInTransaction } from '../settlements/_lib/order-payout-hold';
import { SettlementsService } from '../settlements/settlements.service';
import { CustomerFaultClosureController } from './customer-fault-closure.controller';
import {
  CustomerFaultClosureService,
  decideCustomerFaultClosure,
} from './customer-fault-closure.service';
import { OrderCapacityService } from './order-capacity.service';
import { OrderChargesService } from './order-charges.service';
import { OrdersQueryService } from './orders-query.service';
import { projectSellerOrder } from './seller-order-read-model';

type Occ = ReturnType<typeof createOccFirestore>;

const ORDER_ID = 'order-1';
const ORDER_PATH = `orders/${ORDER_ID}`;
const ROUND_PATH = 'saleRounds/round-1';
const CHARGE_ID = 'charge-1';
const CHARGE_PATH = `orderCharges/${CHARGE_ID}`;
const SETTLEMENT_PATH = `settlements/${ORDER_ID}`;
const HOUR_MS = 60 * 60 * 1000;
const FEE = 5000;

// 기한은 보류가 아니라 결제 요청 시각부터 센다(S-15). 서울 2026-11-10 15:00 보류, 13일 15:00 결제 요청
// → 16일 끝까지 결제 가능 → 17일 00:00(UTC 11-16T15:00)부터 종결 가능. 보류일로 셌다면 14일 00:00부터였다.
const HELD_AT = '2026-11-10T06:00:00.000Z';
const PAYMENT_REQUESTED_AT = '2026-11-13T06:00:00.000Z';
const ELIGIBLE_AT_MS = Date.parse('2026-11-16T15:00:00.000Z');
const BEFORE_BOUNDARY_MS = Date.parse('2026-11-16T14:59:00.000Z'); // 서울 16일 23:59
const AFTER_WINDOW_MS = Date.parse('2026-11-17T01:00:00.000Z'); // 서울 17일 10:00
const WITHIN_WINDOW_MS = Date.parse('2026-11-14T01:00:00.000Z'); // 서울 14일 10:00

const baseHold = {
  heldAt: HELD_AT,
  reasonCode: 'CUSTOMER_UNREACHABLE',
  reasonMessage: '연락이 닿지 않음',
  customerResponsible: true,
  redeliveryFee: FEE,
  nextContactAt: null,
  nextDeliveryAt: null,
  resolvedAt: null,
  paymentRequestedAt: PAYMENT_REQUESTED_AT,
};

/** 판매자가 '재배송 준비로 돌리기'를 누르기 전(결제 요청 전) 보류. */
const { paymentRequestedAt: _requested, ...holdBeforeRequest } = baseHold;

function orderData(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    orderNumber: '20261113-000001',
    storeId: 'store-1',
    userId: 'user-1',
    schemaVersion: 2,
    roundId: 'round-1',
    deliveryMethod: 'direct',
    status: 'DELIVERY_HELD',
    totalAmount: 30000,
    deliveryHold: { ...baseHold },
    ...overrides,
  };
}

function chargeData(overrides: Record<string, unknown> = {}) {
  return {
    id: CHARGE_ID,
    orderId: ORDER_ID,
    storeId: 'store-1',
    userId: 'user-1',
    type: 'REDELIVERY_FEE',
    status: 'PENDING',
    amount: FEE,
    customerResponsible: true,
    holdAt: HELD_AT,
    portonePaymentId: `order-charge-${CHARGE_ID}`,
    createdAt: new Date(AFTER_WINDOW_MS - 30 * HOUR_MS),
    ...overrides,
  };
}

const linkedCharge = {
  redeliveryChargeId: CHARGE_ID,
  redeliveryChargeHoldAt: HELD_AT,
};

function seed(
  occ: Occ,
  options: {
    order?: Record<string, unknown>;
    charge?: Record<string, unknown> | null;
    heldOrderCount?: number;
  } = {},
) {
  occ.seed(ORDER_PATH, orderData(options.order));
  occ.seed('stores/store-1', { ownerId: 'seller-1', commissionRate: 0.1 });
  occ.seed(ROUND_PATH, {
    id: 'round-1',
    storeId: 'store-1',
    status: 'CLOSED',
    counters: {
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 1,
      orderedItemQuantity: 2,
      heldOrderCount: options.heldOrderCount ?? 1,
    },
  });
  if (options.charge) occ.seed(CHARGE_PATH, chargeData(options.charge));
}

/** PortOne 가짜. 기본은 결제창만 열린 결제(READY, 돈 없음)다. */
function makePortone(getPayment?: jest.Mock) {
  return {
    getPayment:
      getPayment ??
      jest.fn().mockResolvedValue({
        id: `order-charge-${CHARGE_ID}`,
        status: 'READY',
        amount: { total: FEE },
      }),
    refund: jest.fn().mockResolvedValue(undefined),
  };
}

function paidPayment(transactionId = 'tx-paid') {
  return {
    id: `order-charge-${CHARGE_ID}`,
    status: 'PAID',
    amount: { total: FEE },
    method: { type: 'CARD' },
    transactionId,
  };
}

function makeService(occ: Occ, options: { portone?: ReturnType<typeof makePortone> } = {}) {
  const capacity = new OrderCapacityService(occ.firestore as never);
  const settlements = new SettlementsService(
    occ.firestore as never,
    { get: () => undefined } as never,
  );
  const portone = options.portone ?? makePortone();
  const chargePayments = new OrderChargePaymentService(occ.firestore as never, portone as never);
  const createSettlement = jest.spyOn(settlements, 'createSettlement');
  const adjustHeld = jest.spyOn(capacity, 'adjustHeldOrderCountInTransaction');
  const refundByOrderId = jest.spyOn(chargePayments, 'refundByOrderId');
  const service = new CustomerFaultClosureService(
    occ.firestore as never,
    capacity,
    settlements,
    chargePayments,
  );
  return { service, createSettlement, adjustHeld, portone, refundByOrderId };
}

const closeInput = {
  storeId: 'store-1',
  orderId: ORDER_ID,
  actorRole: 'seller' as const,
  actorId: 'seller-1',
  memo: '11/14 두 번 통화, 수령 거부 의사 확인',
};

function setNow(ms: number) {
  jest.spyOn(Date, 'now').mockReturnValue(ms);
}

afterEach(() => jest.restoreAllMocks());

describe('decideCustomerFaultClosure 판정표', () => {
  const charge = (overrides: Record<string, unknown>, exists = true) => ({
    chargeId: CHARGE_ID,
    exists,
    data: exists ? chargeData(overrides) : null,
  });

  it.each([
    [
      '기상 보류',
      {
        deliveryHold: {
          ...baseHold,
          reasonCode: 'WEATHER',
          customerResponsible: false,
          redeliveryFee: null,
        },
      },
      'HOLD_REASON_NOT_ELIGIBLE',
    ],
    [
      '상품 파손 보류',
      {
        deliveryHold: {
          ...baseHold,
          reasonCode: 'PRODUCT_DAMAGED',
          customerResponsible: false,
          redeliveryFee: null,
        },
      },
      'HOLD_REASON_NOT_ELIGIBLE',
    ],
    [
      '고객 책임이 아닌 보류',
      {
        deliveryHold: {
          ...baseHold,
          reasonCode: 'ADDRESS_ISSUE',
          customerResponsible: false,
          redeliveryFee: null,
        },
      },
      'NOT_CUSTOMER_RESPONSIBLE',
    ],
    ['회차 주문이 아님(schemaVersion 1)', { schemaVersion: 1 }, 'NOT_ROUND_ORDER'],
    ['회차 id 없음', { roundId: null }, 'NOT_ROUND_ORDER'],
    ['택배 주문', { deliveryMethod: 'parcel' }, 'NOT_DIRECT_DELIVERY'],
    ['거점 주문', { deliveryMethod: 'hub' }, 'NOT_DIRECT_DELIVERY'],
    ['배송 중 주문', { status: 'DELIVERING' }, 'NOT_HELD'],
    [
      '보류가 해소된 DELIVERY_HELD',
      { deliveryHold: { ...baseHold, resolvedAt: '2026-11-14T00:00:00.000Z' } },
      'NOT_HELD',
    ],
    [
      '결제 대기가 아닌 PREPARING',
      {
        status: 'PREPARING',
        deliveryHold: { ...baseHold, resolvedAt: '2026-11-14T00:00:00.000Z' },
      },
      'NOT_HELD',
    ],
    ['취소 진행 중', { cancellation: { status: 'REFUNDING' } }, 'CANCELLATION_IN_PROGRESS'],
    [
      '재배송비 없는 고객 책임 보류(손상)',
      { deliveryHold: { ...baseHold, redeliveryFee: null } },
      'INVALID_HOLD',
    ],
    ['보류 시각 손상', { deliveryHold: { ...baseHold, heldAt: 'broken' } }, 'INVALID_HOLD'],
    ['이미 종결', { status: 'CLOSED_UNDELIVERED' }, 'ALREADY_CLOSED'],
  ])('%s → %s', (_label, overrides, reason) => {
    const decision = decideCustomerFaultClosure(orderData(overrides), null, AFTER_WINDOW_MS);
    expect(decision).toMatchObject({ eligible: false, reason });
  });

  it('수령 거부는 결제 기한과 관계없이 바로 종결할 수 있다', () => {
    const decision = decideCustomerFaultClosure(
      orderData({
        deliveryHold: { ...baseHold, reasonCode: 'RECEIPT_REFUSED' },
      }),
      null,
      Date.parse(HELD_AT) + 60_000,
    );
    expect(decision).toEqual({
      eligible: true,
      reason: 'OK',
      closureReasonCode: 'RECEIPT_REFUSED',
      eligibleAt: HELD_AT,
      paymentDeadlineDate: '2026-11-16',
      redeliveryFee: FEE,
    });
  });

  it('재배송비 미결제는 서울 16일 23:59까지 막히고 17일 00:00부터 종결할 수 있다', () => {
    expect(decideCustomerFaultClosure(orderData(), null, BEFORE_BOUNDARY_MS)).toMatchObject({
      eligible: false,
      reason: 'PAYMENT_WINDOW_OPEN',
      closureReasonCode: 'REDELIVERY_FEE_UNPAID',
      eligibleAt: '2026-11-16T15:00:00.000Z',
      paymentDeadlineDate: '2026-11-16',
    });
    expect(decideCustomerFaultClosure(orderData(), null, ELIGIBLE_AT_MS - 1)).toMatchObject({
      reason: 'PAYMENT_WINDOW_OPEN',
    });
    expect(decideCustomerFaultClosure(orderData(), null, ELIGIBLE_AT_MS)).toMatchObject({
      eligible: true,
      reason: 'OK',
    });
  });

  it('보류일 기준으로는 지났어도 결제 요청일 기준 기한 안이면 막는다(서울 14일 10:00)', () => {
    expect(decideCustomerFaultClosure(orderData(), null, WITHIN_WINDOW_MS)).toMatchObject({
      eligible: false,
      reason: 'PAYMENT_WINDOW_OPEN',
      eligibleAt: '2026-11-16T15:00:00.000Z',
      paymentDeadlineDate: '2026-11-16',
    });
  });

  it('결제 요청 전 보류는 아무리 오래 지나도 PAYMENT_NOT_REQUESTED로 막는다', () => {
    const order = orderData({ deliveryHold: { ...holdBeforeRequest } });
    for (const nowMs of [AFTER_WINDOW_MS, AFTER_WINDOW_MS + 30 * 24 * HOUR_MS]) {
      expect(decideCustomerFaultClosure(order, null, nowMs)).toEqual({
        eligible: false,
        reason: 'PAYMENT_NOT_REQUESTED',
        closureReasonCode: 'REDELIVERY_FEE_UNPAID',
        eligibleAt: null,
        paymentDeadlineDate: null,
        redeliveryFee: FEE,
      });
    }
    // 요청 칸이 null이어도 요청 전이다.
    expect(
      decideCustomerFaultClosure(
        orderData({ deliveryHold: { ...baseHold, paymentRequestedAt: null } }),
        null,
        AFTER_WINDOW_MS,
      ),
    ).toMatchObject({ reason: 'PAYMENT_NOT_REQUESTED' });
  });

  it('요청 전이라도 결제된 재배송비·운영 확인이 필요한 결제는 그 이유를 먼저 보인다', () => {
    const order = orderData({ ...linkedCharge, deliveryHold: { ...holdBeforeRequest } });
    const paid = { chargeId: CHARGE_ID, exists: true, data: chargeData({ status: 'PAID' }) };
    expect(decideCustomerFaultClosure(order, paid, AFTER_WINDOW_MS)).toMatchObject({
      reason: 'REDELIVERY_FEE_PAID',
    });
  });

  it('수령 거부는 결제 요청 전에도 바로 종결할 수 있다', () => {
    expect(
      decideCustomerFaultClosure(
        orderData({ deliveryHold: { ...holdBeforeRequest, reasonCode: 'RECEIPT_REFUSED' } }),
        null,
        Date.parse(HELD_AT) + 60_000,
      ),
    ).toEqual({
      eligible: true,
      reason: 'OK',
      closureReasonCode: 'RECEIPT_REFUSED',
      eligibleAt: HELD_AT,
      paymentDeadlineDate: null,
      redeliveryFee: FEE,
    });
  });

  it('요청 시각이 손상됐거나, 요청 뒤 PREPARING인데 시각이 없으면 기한을 알 수 없어 INVALID_HOLD로 막는다', () => {
    expect(
      decideCustomerFaultClosure(
        orderData({ deliveryHold: { ...baseHold, paymentRequestedAt: 'broken' } }),
        null,
        AFTER_WINDOW_MS,
      ),
    ).toMatchObject({ reason: 'INVALID_HOLD', eligibleAt: null });
    expect(
      decideCustomerFaultClosure(
        orderData({ status: 'PREPARING', deliveryHold: { ...holdBeforeRequest } }),
        null,
        AFTER_WINDOW_MS,
      ),
    ).toMatchObject({ reason: 'INVALID_HOLD' });
  });

  it('결제 요청 뒤 PREPARING으로 돌아와 결제를 기다리는 주문도 종결할 수 있다', () => {
    expect(
      decideCustomerFaultClosure(orderData({ status: 'PREPARING' }), null, AFTER_WINDOW_MS),
    ).toMatchObject({ eligible: true, reason: 'OK' });
  });

  it.each([
    ['PAID', { status: 'PAID' }, 'REDELIVERY_FEE_PAID'],
    [
      'PENDING 24시간 미만',
      {
        status: 'PENDING',
        createdAt: new Date(AFTER_WINDOW_MS - 23 * HOUR_MS),
      },
      'REDELIVERY_PAYMENT_IN_PROGRESS',
    ],
    ['MISMATCHED', { status: 'MISMATCHED' }, 'REDELIVERY_PAYMENT_NEEDS_REVIEW'],
    ['REFUNDED', { status: 'REFUNDED', refundedAt: new Date() }, 'REDELIVERY_PAYMENT_NEEDS_REVIEW'],
    ['다른 금액의 청구(연결 불일치)', { amount: FEE + 1000 }, 'REDELIVERY_PAYMENT_NEEDS_REVIEW'],
    [
      '생성 시각 없는 PENDING',
      { status: 'PENDING', createdAt: null },
      'REDELIVERY_PAYMENT_NEEDS_REVIEW',
    ],
  ])('재배송비 %s → %s(거절)', (_label, overrides, reason) => {
    const decision = decideCustomerFaultClosure(
      orderData(linkedCharge),
      charge(overrides),
      AFTER_WINDOW_MS,
    );
    expect(decision).toMatchObject({ eligible: false, reason });
  });

  it('청구 링크는 있는데 청구 문서가 없거나 다른 보류에 연결돼 있으면 운영 확인으로 막는다', () => {
    expect(
      decideCustomerFaultClosure(orderData(linkedCharge), charge({}, false), AFTER_WINDOW_MS),
    ).toMatchObject({ reason: 'REDELIVERY_PAYMENT_NEEDS_REVIEW' });
    expect(
      decideCustomerFaultClosure(
        orderData({
          ...linkedCharge,
          redeliveryChargeHoldAt: '2026-11-01T00:00:00.000Z',
        }),
        charge({}),
        AFTER_WINDOW_MS,
      ),
    ).toMatchObject({ reason: 'REDELIVERY_PAYMENT_NEEDS_REVIEW' });
    expect(
      decideCustomerFaultClosure(
        orderData({ redeliveryChargeHoldAt: HELD_AT }),
        null,
        AFTER_WINDOW_MS,
      ),
    ).toMatchObject({ reason: 'REDELIVERY_PAYMENT_NEEDS_REVIEW' });
  });

  it.each([
    [
      'PENDING 24시간 이상',
      {
        status: 'PENDING',
        createdAt: new Date(AFTER_WINDOW_MS - 24 * HOUR_MS),
      },
    ],
    ['FAILED', { status: 'FAILED' }],
  ])('재배송비 %s → 종결 가능', (_label, overrides) => {
    expect(
      decideCustomerFaultClosure(orderData(linkedCharge), charge(overrides), AFTER_WINDOW_MS),
    ).toMatchObject({ eligible: true, reason: 'OK' });
  });

  it('수령 거부라도 재배송비가 결제됐거나 결제가 진행 중이면 막는다', () => {
    const refused = {
      ...linkedCharge,
      deliveryHold: { ...baseHold, reasonCode: 'RECEIPT_REFUSED' },
    };
    expect(
      decideCustomerFaultClosure(orderData(refused), charge({ status: 'PAID' }), WITHIN_WINDOW_MS),
    ).toMatchObject({ reason: 'REDELIVERY_FEE_PAID' });
    expect(
      decideCustomerFaultClosure(
        orderData(refused),
        charge({
          status: 'PENDING',
          createdAt: new Date(WITHIN_WINDOW_MS - HOUR_MS),
        }),
        WITHIN_WINDOW_MS,
      ),
    ).toMatchObject({ reason: 'REDELIVERY_PAYMENT_IN_PROGRESS' });
  });
});

describe('CustomerFaultClosureService.close', () => {
  it('종결하면 상태·보류 해소·종결 기록을 남기고 보류 집계를 한 번 줄이며 정산을 만든다(환불 없음)', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, { order: linkedCharge, charge: { status: 'FAILED' } });
    const chargeBefore = occ.getData(CHARGE_PATH);
    const { service, createSettlement, adjustHeld } = makeService(occ);

    await expect(service.close(closeInput)).resolves.toEqual({
      orderId: ORDER_ID,
      status: 'CLOSED_UNDELIVERED',
      alreadyClosed: false,
    });

    const order = occ.getData(ORDER_PATH)!;
    expect(order).toMatchObject({
      status: 'CLOSED_UNDELIVERED',
      deliveryHold: { ...baseHold, resolvedAt: expect.any(String) },
      customerFaultClosure: {
        reasonCode: 'REDELIVERY_FEE_UNPAID',
        heldAt: HELD_AT,
        redeliveryFee: FEE,
        actorRole: 'seller',
        actorId: 'seller-1',
        memo: closeInput.memo,
        closedAt: expect.any(String),
      },
    });
    // 취소·환불 흔적이 없다.
    expect(order['cancellation']).toBeUndefined();
    expect(order['cancelReason']).toBeUndefined();
    expect(occ.getData(CHARGE_PATH)).toEqual(chargeBefore);
    expect(occ.listData('payments/')).toEqual([]);
    // 회차 수량(주문 수·상품 수)은 그대로, 보류 집계만 1 → 0.
    expect(occ.getData(ROUND_PATH)!['counters']).toEqual({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 1,
      orderedItemQuantity: 2,
      heldOrderCount: 0,
    });
    expect(adjustHeld).toHaveBeenCalledTimes(1);
    expect(createSettlement).toHaveBeenCalledTimes(1);
    expect(createSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ id: ORDER_ID, totalAmount: 30000 }),
      'CLOSED_UNDELIVERED',
    );
    expect(occ.getData(SETTLEMENT_PATH)).toMatchObject({
      orderId: ORDER_ID,
      storeId: 'store-1',
      roundId: 'round-1',
      totalAmount: 30000,
      platformFeeRate: 0.1,
      netAmount: 27000,
      status: 'pending',
      completedStatus: 'CLOSED_UNDELIVERED',
    });
  });

  it('본 결제 환불 서비스에 의존하지 않고, 재배송비 결제 서비스는 종결 전 확인에만 쓴다', async () => {
    const paramTypes: unknown[] =
      Reflect.getMetadata('design:paramtypes', CustomerFaultClosureService) ?? [];
    const names = paramTypes.map((type) => (type as { name?: string })?.name);
    expect(names).toEqual([
      'FirestoreService',
      'OrderCapacityService',
      'SettlementsService',
      'OrderChargePaymentService',
    ]);

    // 결제되지 않은 PENDING 재배송비를 확인하고 종결해도 환불은 부르지 않는다.
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, { order: linkedCharge, charge: {} });
    const { service, portone, refundByOrderId } = makeService(occ);
    await service.close(closeInput);
    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    expect(portone.refund).not.toHaveBeenCalled();
    expect(refundByOrderId).not.toHaveBeenCalled();
  });

  it('수령 거부는 보류 다음 날 바로 종결하고 사유를 RECEIPT_REFUSED로 남긴다', async () => {
    setNow(WITHIN_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, {
      order: { deliveryHold: { ...baseHold, reasonCode: 'RECEIPT_REFUSED' } },
    });
    const { service } = makeService(occ);

    await service.close(closeInput);

    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CLOSED_UNDELIVERED',
      customerFaultClosure: { reasonCode: 'RECEIPT_REFUSED' },
    });
  });

  it('결제 대기 PREPARING 주문도 보류 집계를 정확히 한 번 줄인다', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, { order: { status: 'PREPARING' }, heldOrderCount: 2 });
    const { service } = makeService(occ);

    await service.close(closeInput);

    expect(occ.getData(ROUND_PATH)!['counters']).toMatchObject({
      heldOrderCount: 1,
    });
  });

  it('같은 요청을 다시 보내면 집계를 다시 줄이지 않고 정산만 맞춘다', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, { heldOrderCount: 3 });
    const { service, createSettlement, adjustHeld } = makeService(occ);
    await service.close(closeInput);
    // 첫 요청 뒤 정산 생성이 실패해 정산이 없는 상태를 흉내 낸다.
    occ.deleteOutsideTransaction(SETTLEMENT_PATH);
    const closedOrder = occ.getData(ORDER_PATH);

    await expect(service.close({ ...closeInput, memo: '다시 누름' })).resolves.toEqual({
      orderId: ORDER_ID,
      status: 'CLOSED_UNDELIVERED',
      alreadyClosed: true,
    });

    expect(adjustHeld).toHaveBeenCalledTimes(1);
    expect(occ.getData(ROUND_PATH)!['counters']).toMatchObject({
      heldOrderCount: 2,
    });
    expect(occ.getData(ORDER_PATH)).toEqual(closedOrder);
    expect(createSettlement).toHaveBeenCalledTimes(2);
    expect(occ.getData(SETTLEMENT_PATH)).toMatchObject({
      completedStatus: 'CLOSED_UNDELIVERED',
    });

    // 정산이 이미 있으면 그대로 둔다(정산 시각을 다시 쓰지 않는다).
    const settlement = occ.getData(SETTLEMENT_PATH);
    await service.close(closeInput);
    expect(occ.getData(SETTLEMENT_PATH)).toEqual(settlement);
  });

  it('동시에 두 번 종결해도 보류 집계는 한 번만 줄어든다', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, { heldOrderCount: 2 });
    const { service } = makeService(occ);

    const results = await Promise.all([service.close(closeInput), service.close(closeInput)]);

    expect(results.map((r) => r.alreadyClosed).sort()).toEqual([false, true]);
    expect(occ.getData(ROUND_PATH)!['counters']).toMatchObject({
      heldOrderCount: 1,
    });
  });

  it.each([
    ['결제 기한 안', {}, null, WITHIN_WINDOW_MS, ConflictException, '결제 기한'],
    [
      '재배송비 결제 완료',
      linkedCharge,
      { status: 'PAID' },
      AFTER_WINDOW_MS,
      ConflictException,
      '결제된',
    ],
    [
      '재배송비 결제 진행 중',
      linkedCharge,
      { status: 'PENDING', createdAt: new Date(AFTER_WINDOW_MS - HOUR_MS) },
      AFTER_WINDOW_MS,
      ConflictException,
      '진행 중',
    ],
    [
      '재배송비 불일치',
      linkedCharge,
      { status: 'MISMATCHED' },
      AFTER_WINDOW_MS,
      ConflictException,
      '운영팀',
    ],
    [
      '취소 진행 중',
      { cancellation: { status: 'REFUND_FAILED' } },
      null,
      AFTER_WINDOW_MS,
      ConflictException,
      '취소',
    ],
    [
      '기상 보류',
      {
        deliveryHold: {
          ...baseHold,
          reasonCode: 'WEATHER',
          customerResponsible: false,
          redeliveryFee: null,
        },
      },
      null,
      AFTER_WINDOW_MS,
      ForbiddenException,
      '기상',
    ],
    [
      '택배 주문',
      { deliveryMethod: 'parcel' },
      null,
      AFTER_WINDOW_MS,
      ForbiddenException,
      '직배송',
    ],
  ])(
    '%s이면 거절하고 아무것도 바꾸지 않는다',
    async (_label, order, charge, now, ErrorType, text) => {
      setNow(now);
      const occ = createOccFirestore();
      seed(occ, { order, charge });
      const before = occ.getData(ORDER_PATH);
      const { service, createSettlement } = makeService(occ);

      const error = await service.close(closeInput).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ErrorType);
      expect((error as Error).message).toContain(text);
      expect(occ.getData(ORDER_PATH)).toEqual(before);
      expect(occ.getData(ROUND_PATH)!['counters']).toMatchObject({
        heldOrderCount: 1,
      });
      expect(createSettlement).not.toHaveBeenCalled();
      expect(occ.getData(SETTLEMENT_PATH)).toBeUndefined();
    },
  );

  it('다른 매장 주문은 찾을 수 없다고 답한다', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ);
    const { service } = makeService(occ);

    await expect(service.close({ ...closeInput, storeId: 'store-2' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getEligibility('store-2', ORDER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('빈 메모는 거절한다', async () => {
    const occ = createOccFirestore();
    seed(occ);
    const { service } = makeService(occ);
    await expect(service.close({ ...closeInput, memo: '   ' })).rejects.toThrow('연락한 내용');
  });

  it('GET 판정은 트랜잭션 판정과 같은 결과를 준다', async () => {
    setNow(BEFORE_BOUNDARY_MS);
    const occ = createOccFirestore();
    seed(occ, { order: linkedCharge, charge: { status: 'FAILED' } });
    const { service } = makeService(occ);

    await expect(service.getEligibility('store-1', ORDER_ID)).resolves.toMatchObject({
      eligible: false,
      reason: 'PAYMENT_WINDOW_OPEN',
      eligibleAt: '2026-11-16T15:00:00.000Z',
    });
    setNow(ELIGIBLE_AT_MS);
    await expect(service.getEligibility('store-1', ORDER_ID)).resolves.toMatchObject({
      eligible: true,
      reason: 'OK',
    });
  });

  it('결제 요청 전 보류는 종결 요청을 새 안내로 거절하고 주문·집계를 바꾸지 않는다', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, { order: { deliveryHold: { ...holdBeforeRequest } } });
    const { service, adjustHeld, createSettlement } = makeService(occ);

    await expect(service.getEligibility('store-1', ORDER_ID)).resolves.toMatchObject({
      eligible: false,
      reason: 'PAYMENT_NOT_REQUESTED',
    });
    const attempt = service.close(closeInput);
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow(
      "손님에게 재배송비 결제 요청을 보낸 뒤 3일이 지나야 종결할 수 있습니다. 먼저 '재배송 준비로 돌리기'를 눌러 주세요.",
    );
    expect(occ.getData(ORDER_PATH)).toMatchObject({ status: 'DELIVERY_HELD' });
    expect(occ.getData(ROUND_PATH)?.['counters']?.['heldOrderCount']).toBe(1);
    expect(adjustHeld).not.toHaveBeenCalled();
    expect(createSettlement).not.toHaveBeenCalled();
  });
});

describe('CustomerFaultClosureController 권한', () => {
  function makeController(occ: Occ) {
    const closures = {
      getEligibility: jest.fn().mockResolvedValue({ eligible: true }),
      close: jest.fn().mockResolvedValue({ status: 'CLOSED_UNDELIVERED' }),
    };
    const controller = new CustomerFaultClosureController(
      closures as never,
      occ.firestore as never,
    );
    return { controller, closures };
  }

  it('다른 매장 판매자는 판정·종결 모두 거절한다', async () => {
    const occ = createOccFirestore();
    seed(occ);
    const { controller, closures } = makeController(occ);
    const other = { sub: 'seller-2', role: 'seller' } as never;

    await expect(controller.getEligibility('store-1', ORDER_ID, other)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      controller.close('store-1', ORDER_ID, other, { memo: '메모' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(closures.close).not.toHaveBeenCalled();
  });

  it('매장 주인은 seller로, 관리자는 admin으로 기록한다', async () => {
    const occ = createOccFirestore();
    seed(occ);
    const { controller, closures } = makeController(occ);

    await controller.close('store-1', ORDER_ID, { sub: 'seller-1', role: 'seller' } as never, {
      memo: '메모',
    });
    await controller.close('store-1', ORDER_ID, { sub: 'admin-1', role: 'admin' } as never, {
      memo: '메모',
    });

    expect(closures.close).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ actorRole: 'seller', actorId: 'seller-1' }),
    );
    expect(closures.close).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ actorRole: 'admin', actorId: 'admin-1' }),
    );
  });
});

describe('종결 직전 PENDING 재배송비 PortOne 확인', () => {
  // 1일째 결제를 시작했다가 그만둔 뒤 마감일 23:55에 같은 결제로 끝냈는데 웹훅이 늦어 30시간 된 PENDING으로 남은 경우.
  const stalePending = { status: 'PENDING', createdAt: new Date(AFTER_WINDOW_MS - 30 * HOUR_MS) };

  function expectUnchanged(occ: Occ, before: unknown, createSettlement: jest.SpyInstance) {
    expect(occ.getData(ORDER_PATH)).toEqual(before);
    expect(occ.getData(ROUND_PATH)!['counters']).toMatchObject({ heldOrderCount: 1 });
    expect(createSettlement).not.toHaveBeenCalled();
    expect(occ.getData(SETTLEMENT_PATH)).toBeUndefined();
  }

  it('24시간 넘은 PENDING이라도 PortOne이 PAID면 기존 확정 경로로 확정하고 종결을 거절한다(환불 없음)', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, { order: linkedCharge, charge: stalePending });
    const before = occ.getData(ORDER_PATH);
    const portone = makePortone(jest.fn().mockResolvedValue(paidPayment('tx-late-deadline')));
    const { service, createSettlement } = makeService(occ, { portone });

    const error = await service.close(closeInput).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toContain('재배송비가 결제된');
    expect(portone.getPayment).toHaveBeenCalledWith(`order-charge-${CHARGE_ID}`);
    // 재배송에 쓰는 결제로 확정됐다(필요 없어진 결제·환불이 아니다).
    expect(occ.getData(CHARGE_PATH)).toMatchObject({
      status: 'PAID',
      portoneTransactionId: 'tx-late-deadline',
      paidAt: expect.anything(),
    });
    expect(occ.getData(CHARGE_PATH)!['unneededPaidAt']).toBeUndefined();
    expect(portone.refund).not.toHaveBeenCalled();
    expectUnchanged(occ, before, createSettlement);
    // 다시 판정하면 결제 완료로 보인다.
    await expect(service.getEligibility('store-1', ORDER_ID)).resolves.toMatchObject({
      reason: 'REDELIVERY_FEE_PAID',
    });
  });

  it.each([
    ['PortOne 오류', () => Promise.reject(new PortoneError(500, 'INTERNAL', 'boom'))],
    ['네트워크 오류', () => Promise.reject(new Error('timeout'))],
    [
      '가상계좌 발급(입금 대기)',
      () => Promise.resolve({ status: 'VIRTUAL_ACCOUNT_ISSUED', amount: { total: FEE } }),
    ],
    ['결제 승인 대기', () => Promise.resolve({ status: 'PAY_PENDING', amount: { total: FEE } })],
    [
      '금액이 다른 PAID(확정 실패)',
      () => Promise.resolve({ ...paidPayment(), amount: { total: FEE + 1 } }),
    ],
  ])('%s이면 결제 여부를 확정하지 못해 거절한다(fail closed)', async (_label, lookup) => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, { order: linkedCharge, charge: stalePending });
    const before = occ.getData(ORDER_PATH);
    const portone = makePortone(jest.fn().mockImplementation(lookup));
    const { service, createSettlement } = makeService(occ, { portone });

    const error = await service.close(closeInput).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(
      '재배송비 결제 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
    );
    expect(occ.getData(CHARGE_PATH)).toMatchObject({ status: 'PENDING' });
    expect(portone.refund).not.toHaveBeenCalled();
    expectUnchanged(occ, before, createSettlement);
  });

  it('같은 청구를 방금 다른 요청이 조회했으면 PortOne을 다시 부르지 않고 거절한다', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, {
      order: linkedCharge,
      charge: { ...stalePending, paymentCheckRequestedAtMs: AFTER_WINDOW_MS - 1000 },
    });
    const { service, portone, createSettlement } = makeService(occ);
    const before = occ.getData(ORDER_PATH);

    await expect(service.close(closeInput)).rejects.toThrow('확인하지 못했어요');
    expect(portone.getPayment).not.toHaveBeenCalled();
    expectUnchanged(occ, before, createSettlement);
  });

  it.each([
    ['결제창만 열림(READY)', () => Promise.resolve({ status: 'READY', amount: { total: FEE } })],
    ['결제 실패', () => Promise.resolve({ status: 'FAILED', amount: { total: FEE } })],
    ['결제사 쪽 취소', () => Promise.resolve({ status: 'CANCELLED', amount: { total: FEE } })],
    [
      '결제 없음(404)',
      () => Promise.reject(new PortoneError(404, 'PAYMENT_NOT_FOUND', 'not found')),
    ],
  ])('%s이면 결제되지 않은 것으로 확인하고 종결한다', async (_label, lookup) => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, { order: linkedCharge, charge: stalePending });
    const portone = makePortone(jest.fn().mockImplementation(lookup));
    const { service } = makeService(occ, { portone });

    await expect(service.close(closeInput)).resolves.toMatchObject({ alreadyClosed: false });
    expect(portone.getPayment).toHaveBeenCalledTimes(1);
    // 청구는 FAILED로 닫지 않는다(조회 시각만 남는다).
    expect(occ.getData(CHARGE_PATH)).toMatchObject({ status: 'PENDING' });
    expect(occ.getData(ORDER_PATH)).toMatchObject({ status: 'CLOSED_UNDELIVERED' });
  });

  it('24시간이 안 된 PENDING은 결제되지 않았다고 확인돼도 기존 판정표대로 진행 중으로 막는다', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, {
      order: linkedCharge,
      charge: { status: 'PENDING', createdAt: new Date(AFTER_WINDOW_MS - HOUR_MS) },
    });
    const { service, portone } = makeService(occ);

    await expect(service.close(closeInput)).rejects.toThrow('진행 중');
    expect(portone.getPayment).toHaveBeenCalledTimes(1);
  });

  it('확인과 트랜잭션 사이에 결제가 확정되면 트랜잭션이 청구를 다시 읽어 거절한다', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, { order: linkedCharge, charge: stalePending });
    const portone = makePortone(
      jest.fn().mockImplementation(async () => {
        // PortOne이 READY라고 답한 직후 웹훅이 PAID로 확정한 상황.
        occ.updateOutsideTransaction(CHARGE_PATH, { status: 'PAID', paidAt: new Date() });
        return { status: 'READY', amount: { total: FEE } };
      }),
    );
    const { service } = makeService(occ, { portone });

    await expect(service.close(closeInput)).rejects.toThrow('재배송비가 결제된');
    expect(occ.getData(ORDER_PATH)).toMatchObject({ status: 'DELIVERY_HELD' });
  });

  it.each([
    ['FAILED', { status: 'FAILED' }],
    ['PAID', { status: 'PAID' }],
  ])('%s 청구는 PortOne에 묻지 않는다', async (_label, charge) => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, { order: linkedCharge, charge });
    const { service, portone } = makeService(occ);

    await service.close(closeInput).catch(() => undefined);
    expect(portone.getPayment).not.toHaveBeenCalled();
  });

  it('유료 재배송 뒤 새 보류(이전 보류에 연결된 청구)는 PortOne에 묻지 않고 운영 확인으로 막는다', async () => {
    setNow(Date.parse('2026-11-25T01:00:00.000Z'));
    const occ = createOccFirestore();
    const secondHeldAt = '2026-11-20T06:00:00.000Z';
    seed(occ, {
      order: { ...linkedCharge, deliveryHold: { ...baseHold, heldAt: secondHeldAt } },
      charge: { status: 'PAID', paidAt: new Date(AFTER_WINDOW_MS) },
    });
    const { service, portone } = makeService(occ);

    await expect(service.close(closeInput)).rejects.toThrow('운영팀');
    expect(portone.getPayment).not.toHaveBeenCalled();
    expect(occ.getData(ORDER_PATH)).toMatchObject({ status: 'DELIVERY_HELD' });
  });
});

describe('회차 취소와 종결의 경합', () => {
  it.each([
    ['취소 작업 진행 중(CANCELLING)', { status: 'CLOSED', cancellation: { status: 'CANCELLING' } }],
    [
      '취소 로컬 실패 뒤 재시도 대기',
      { status: 'CLOSED', cancellation: { status: 'LOCAL_FAILED' } },
    ],
    ['취소 완료', { status: 'CANCELLED', cancellation: { status: 'COMPLETED' } }],
  ])('회차가 %s이면 종결을 거절하고 아무것도 바꾸지 않는다', async (_label, round) => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ);
    occ.updateOutsideTransaction(ROUND_PATH, round);
    const before = occ.getData(ORDER_PATH);
    const { service, createSettlement } = makeService(occ);

    const error = await service.close(closeInput).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe('회차 취소가 진행 중이라 종결할 수 없어요.');
    expect(occ.getData(ORDER_PATH)).toEqual(before);
    expect(occ.getData(ROUND_PATH)!['counters']).toMatchObject({ heldOrderCount: 1 });
    expect(createSettlement).not.toHaveBeenCalled();
  });

  it('종결 트랜잭션이 회차를 읽은 뒤 회차 취소가 시작되면 다시 읽어 거절한다', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ);
    occ.setBeforeCommit(() => {
      occ.updateOutsideTransaction(ROUND_PATH, {
        cancellation: { status: 'CANCELLING', ownerId: 'o', leaseId: 'l' },
      });
    });
    const { service } = makeService(occ);

    await expect(service.close(closeInput)).rejects.toThrow('회차 취소가 진행 중');
    expect(occ.getData(ORDER_PATH)).toMatchObject({ status: 'DELIVERY_HELD' });
    expect(occ.getData(ROUND_PATH)!['counters']).toMatchObject({ heldOrderCount: 1 });
  });

  it('회차 취소가 주문을 정리하는 중에 판매자가 종결하면 거절되고 회차 취소가 주문을 정리한다', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ);
    const { service } = makeService(occ);
    let closureError: unknown = null;
    const roundLifecycle = {
      cancelForRound: jest.fn().mockImplementation(async ({ orderId }: { orderId: string }) => {
        closureError = await service.close(closeInput).catch((e: unknown) => e);
        // 회차 취소의 주문 취소(환불)를 흉내 낸다.
        occ.updateOutsideTransaction(`orders/${orderId}`, {
          status: 'CANCELLED',
          cancellation: { status: 'COMPLETED' },
        });
      }),
    };
    const roundState = new SaleRoundStateService(occ.firestore as never, roundLifecycle as never);

    await expect(
      roundState.cancel({ storeId: 'store-1', roundId: 'round-1', reason: '판매자 회차 취소' }),
    ).resolves.toMatchObject({ status: 'CANCELLED' });

    expect(roundLifecycle.cancelForRound).toHaveBeenCalledTimes(1);
    expect(closureError).toBeInstanceOf(ConflictException);
    expect((closureError as Error).message).toContain('회차 취소가 진행 중');
    expect(occ.getData(ORDER_PATH)).toMatchObject({ status: 'CANCELLED' });
    expect(occ.getData(ORDER_PATH)!['customerFaultClosure']).toBeUndefined();
  });
});

describe('종결 뒤 정산이 없을 때 다시 맞추기', () => {
  it('종결 뒤 정산 생성이 실패하면 GET이 정산 없음을 알리고, 같은 POST로 정산을 맞춘 뒤에는 알리지 않는다', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ);
    const { service, createSettlement, adjustHeld } = makeService(occ);
    createSettlement.mockRejectedValueOnce(new Error('정산 쓰기 실패'));

    await expect(service.close(closeInput)).rejects.toThrow('정산 쓰기 실패');
    expect(occ.getData(ORDER_PATH)).toMatchObject({ status: 'CLOSED_UNDELIVERED' });
    expect(occ.getData(SETTLEMENT_PATH)).toBeUndefined();

    await expect(service.getEligibility('store-1', ORDER_ID)).resolves.toMatchObject({
      reason: 'ALREADY_CLOSED',
      settlementMissing: true,
    });

    await expect(
      service.close({ ...closeInput, memo: '정산 다시 맞추기' }),
    ).resolves.toMatchObject({ alreadyClosed: true });
    expect(adjustHeld).toHaveBeenCalledTimes(1);
    expect(occ.getData(SETTLEMENT_PATH)).toMatchObject({
      completedStatus: 'CLOSED_UNDELIVERED',
    });
    // 종결 기록(메모)은 첫 종결 그대로다.
    expect(occ.getData(ORDER_PATH)!['customerFaultClosure']).toMatchObject({
      memo: closeInput.memo,
    });
    await expect(service.getEligibility('store-1', ORDER_ID)).resolves.toMatchObject({
      reason: 'ALREADY_CLOSED',
      settlementMissing: false,
    });
  });

  it('종결 전 판정에는 정산 여부를 싣지 않는다', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ);
    const { service } = makeService(occ);
    const decision = await service.getEligibility('store-1', ORDER_ID);
    expect(decision).toMatchObject({ reason: 'OK' });
    expect(decision.settlementMissing).toBeUndefined();
  });
});

describe('종결 뒤 다른 흐름과의 정합성', () => {
  it('24시간 넘게 멈춘 재배송비를 종결 뒤 결제하면 주문에 반영하지 않고 자동 환불한다', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, {
      order: linkedCharge,
      charge: {
        status: 'PENDING',
        createdAt: new Date(AFTER_WINDOW_MS - 25 * HOUR_MS),
      },
    });
    const { service } = makeService(occ);
    await service.close(closeInput);

    const portone = {
      getPayment: jest.fn().mockResolvedValue({
        id: `order-charge-${CHARGE_ID}`,
        status: 'PAID',
        amount: { total: FEE },
        method: { type: 'CARD' },
        transactionId: 'tx-late',
      }),
      refund: jest.fn().mockResolvedValue(undefined),
    };
    const payments = new OrderChargePaymentService(occ.firestore as never, portone as never);

    await expect(
      payments.handleWebhook('Transaction.Paid', `order-charge-${CHARGE_ID}`),
    ).resolves.toEqual({
      ok: true,
      status: 'PAID',
      reason: 'unneeded_charge_refund',
    });

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData(CHARGE_PATH)).toMatchObject({
      status: 'REFUNDED',
      unneededPaidAt: expect.anything(),
      refundedAt: expect.anything(),
    });
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CLOSED_UNDELIVERED',
    });
  });

  it('종결 뒤에는 새 재배송비 결제를 만들 수 없다', async () => {
    setNow(WITHIN_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ, {
      order: { deliveryHold: { ...baseHold, reasonCode: 'RECEIPT_REFUSED' } },
    });
    const { service } = makeService(occ);
    await service.close(closeInput);

    const charges = new OrderChargesService(
      occ.firestore as never,
      { createOrMergeIssue: jest.fn() } as never,
    );
    await expect(
      charges.createRedeliveryFeeCharge({
        storeId: 'store-1',
        orderId: ORDER_ID,
        requesterId: 'user-1',
        idempotencyKey: 'late',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('종결 주문의 정산은 지급 보류 대상이 아니다', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ);
    const { service } = makeService(occ);
    await service.close(closeInput);

    const hold = await occ.firestore.runTransaction((tx) =>
      readOrderPayoutHoldInTransaction(occ.firestore as never, tx as never, ORDER_ID),
    );
    expect(hold).toBeNull();
  });

  it('종결 주문만 남은 회차는 완료할 수 있다', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ);
    occ.seed('orders/order-2', {
      id: 'order-2',
      storeId: 'store-1',
      roundId: 'round-1',
      status: 'DELIVERED',
    });
    const { service } = makeService(occ);
    const roundState = new SaleRoundStateService(occ.firestore as never, {} as never);

    // 종결 전에는 보류 주문이 남아 완료할 수 없다.
    await expect(
      roundState.complete({ storeId: 'store-1', roundId: 'round-1' }),
    ).rejects.toBeInstanceOf(ConflictException);

    await service.close(closeInput);

    await expect(
      roundState.complete({ storeId: 'store-1', roundId: 'round-1' }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('회차 취소는 종결 주문을 건너뛴다(환불하지 않는다)', async () => {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ);
    const { service } = makeService(occ);
    await service.close(closeInput);
    const roundLifecycle = { cancelForRound: jest.fn() };
    const roundState = new SaleRoundStateService(occ.firestore as never, roundLifecycle as never);

    await expect(
      roundState.cancel({
        storeId: 'store-1',
        roundId: 'round-1',
        reason: '판매자 회차 취소',
      }),
    ).resolves.toMatchObject({ status: 'CANCELLED' });

    expect(roundLifecycle.cancelForRound).not.toHaveBeenCalled();
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CLOSED_UNDELIVERED',
    });
  });
});

describe('종결 기록의 읽기 범위', () => {
  async function closedOcc() {
    setNow(AFTER_WINDOW_MS);
    const occ = createOccFirestore();
    seed(occ);
    await makeService(occ).service.close(closeInput);
    return occ;
  }

  it('손님 응답(주문 상세·내 주문)에는 판매자 메모·처리자가 없다', async () => {
    const occ = await closedOcc();
    const query = new OrdersQueryService(occ.firestore as never);

    const detail = await query.getOrderById(ORDER_ID, {
      sub: 'user-1',
      role: 'consumer',
    });
    const [mine] = await query.getMyOrders('user-1');

    for (const order of [detail, mine]) {
      expect(order).toMatchObject({
        status: 'CLOSED_UNDELIVERED',
        customerFaultClosure: {
          reasonCode: 'REDELIVERY_FEE_UNPAID',
          heldAt: HELD_AT,
          redeliveryFee: FEE,
          closedAt: expect.any(String),
        },
      });
      expect(order['customerFaultClosure']).not.toHaveProperty('memo');
      expect(order['customerFaultClosure']).not.toHaveProperty('actorId');
      expect(order['customerFaultClosure']).not.toHaveProperty('actorRole');
      expect(JSON.stringify(order)).not.toContain(closeInput.memo);
    }
  });

  it('판매자 상세에는 메모를 싣고 처리자 id는 싣지 않는다', async () => {
    const occ = await closedOcc();
    const projected = projectSellerOrder(occ.getData(ORDER_PATH)!, 'detail');
    expect(projected['customerFaultClosure']).toEqual({
      reasonCode: 'REDELIVERY_FEE_UNPAID',
      heldAt: HELD_AT,
      redeliveryFee: FEE,
      actorRole: 'seller',
      memo: closeInput.memo,
      closedAt: expect.any(String),
    });
    expect(projectSellerOrder(occ.getData(ORDER_PATH)!, 'list')).not.toHaveProperty(
      'customerFaultClosure',
    );
  });
});

describe('재배송비 결제 요청 시각의 읽기 범위(S-15)', () => {
  it('판매자 상세와 손님 주문 응답에 보류의 결제 요청 시각이 실린다', async () => {
    const occ = createOccFirestore();
    seed(occ, { order: { status: 'PREPARING' } });
    const order = occ.getData(ORDER_PATH)!;

    expect(projectSellerOrder(order, 'detail')['deliveryHold']).toMatchObject({
      heldAt: HELD_AT,
      paymentRequestedAt: PAYMENT_REQUESTED_AT,
    });

    const query = new OrdersQueryService(occ.firestore as never);
    const detail = await query.getOrderById(ORDER_ID, { sub: 'user-1', role: 'consumer' });
    const [mine] = await query.getMyOrders('user-1');
    for (const consumerOrder of [detail, mine]) {
      expect(consumerOrder['deliveryHold']).toMatchObject({
        paymentRequestedAt: PAYMENT_REQUESTED_AT,
      });
    }
  });
});
