import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createMvpSalesRoundFixture } from './helpers/mvp-sales-round-fixture';

type Fixture = Awaited<ReturnType<typeof createMvpSalesRoundFixture>>;
type Data = Record<string, any>;

const STORE_ID = 'store-1';
const ORDER_ID = 'admin-refund-order-1';
const ROUND_ID = 'admin-refund-round-1';
const ROUND_ITEM_ID = 'admin-refund-item-1';
const RESERVATION_ID = 'admin-refund-reservation-1';
const CHARGE_ID = 'admin-refund-charge-1';
const MAIN_PROVIDER_PAYMENT_ID = 'admin-refund-payment-1';
const CHARGE_PROVIDER_PAYMENT_ID = `order-charge-${CHARGE_ID}`;
const HOLD_AT = '2026-08-26T00:00:00.000Z';
const REFUND_REASON = '관리자 회차 환불 회귀';

function seedRoundRefund(fixture: Fixture, overrides: Data = {}) {
  const orderStatus = overrides.orderStatus ?? 'DELIVERY_HELD';
  const settlementStatus = overrides.settlementStatus ?? 'pending';
  const paymentStatus = overrides.paymentStatus ?? 'PAID';
  const chargeStatus = overrides.chargeStatus ?? 'PAID';

  fixture.records.set(`saleRounds/${ROUND_ID}`, {
    id: ROUND_ID,
    storeId: STORE_ID,
    status: 'CLOSED',
    schedule: { orderCloseAt: '2026-08-25T00:00:00.000Z' },
    limits: { maxDeliveryAddresses: 10, maxItemQuantity: 20 },
    counters: {
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 1,
      orderedItemQuantity: 2,
      heldOrderCount: orderStatus === 'DELIVERY_HELD' ? 1 : 0,
    },
  });
  fixture.records.set(`saleRoundItems/${ROUND_ITEM_ID}`, {
    id: ROUND_ITEM_ID,
    roundId: ROUND_ID,
    storeId: STORE_ID,
    productId: 'product-1',
    productNameSnapshot: '호접란',
    productImageUrlSnapshot: null,
    roundPrice: 20_000,
    saleLimitQuantity: 20,
    reservedQuantity: 0,
    orderedQuantity: 2,
    status: 'ACTIVE',
  });
  fixture.records.set(`checkoutReservations/${RESERVATION_ID}`, {
    id: RESERVATION_ID,
    roundId: ROUND_ID,
    storeId: STORE_ID,
    userId: 'consumer-1',
    orderId: ORDER_ID,
    paymentId: ORDER_ID,
    status: 'CONSUMED',
    addressKey: 'admin-refund-address',
    deliveryAddressCount: 1,
    itemQuantityTotal: 2,
    items: [
      {
        roundItemId: ROUND_ITEM_ID,
        productId: 'product-1',
        productName: '호접란',
        productImageUrl: null,
        quantity: 2,
        unitPrice: 20_000,
      },
    ],
    idempotencyKey: 'admin-refund-checkout-1',
    expiresAt: '2099-08-26T00:00:00.000Z',
    consumedAt: '2026-08-24T00:00:00.000Z',
    releasedAt: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
  });
  fixture.records.set(`orders/${ORDER_ID}`, {
    id: ORDER_ID,
    schemaVersion: 2,
    saleType: 'normal',
    deliveryMethod: 'direct',
    storeId: STORE_ID,
    roundId: ROUND_ID,
    reservationId: RESERVATION_ID,
    userId: 'consumer-1',
    status: orderStatus,
    totalAmount: 40_000,
    orderItems: [{ roundItemId: ROUND_ITEM_ID, quantity: 2 }],
    redeliveryChargeId: CHARGE_ID,
    redeliveryChargeHoldAt: HOLD_AT,
    deliveryHold: {
      customerResponsible: true,
      redeliveryFee: 5_000,
      heldAt: HOLD_AT,
      resolvedAt: null,
    },
    ...overrides.order,
  });
  fixture.records.set(`payments/${ORDER_ID}`, {
    id: 'admin-refund-payment-1',
    orderId: ORDER_ID,
    storeId: STORE_ID,
    userId: 'consumer-1',
    status: paymentStatus,
    amount: 40_000,
    portonePaymentId: MAIN_PROVIDER_PAYMENT_ID,
    refundClaim: null,
    refundedAt: null,
  });
  fixture.records.set(`orderCharges/${CHARGE_ID}`, {
    id: CHARGE_ID,
    orderId: ORDER_ID,
    storeId: STORE_ID,
    userId: 'consumer-1',
    type: 'REDELIVERY_FEE',
    status: chargeStatus,
    amount: 5_000,
    customerResponsible: true,
    holdAt: HOLD_AT,
    portonePaymentId: CHARGE_PROVIDER_PAYMENT_ID,
    refundClaim: null,
    refundedAt: null,
  });
  fixture.records.set(`settlements/${ORDER_ID}`, {
    id: ORDER_ID,
    orderId: ORDER_ID,
    storeId: STORE_ID,
    status: settlementStatus,
    totalAmount: 40_000,
    settledAt: new Date('2026-08-24T00:00:00.000Z'),
    confirmedAt: settlementStatus === 'confirmed' ? new Date('2026-08-25T00:00:00.000Z') : null,
    paidAt: settlementStatus === 'paid' ? new Date('2026-08-25T00:00:00.000Z') : null,
  });
}

function recordSnapshot(fixture: Fixture) {
  return [...fixture.records.entries()]
    .map(([path, data]) => [path, JSON.stringify(data)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
}

function adminRefund(fixture: Fixture, reason = REFUND_REASON) {
  return request(fixture.app.getHttpServer())
    .post(`/admin/orders/${ORDER_ID}/refund`)
    .set('x-test-user', 'admin-1')
    .set('x-test-role', 'admin')
    .send({ reason });
}

function expectRoundCancellation(fixture: Fixture, settlementStatus: 'cancelled' | 'paid') {
  expect(fixture.read(`orders/${ORDER_ID}`)).toMatchObject({
    status: 'CANCELLED',
    cancelReason: REFUND_REASON,
    cancellation: { status: 'COMPLETED', reason: REFUND_REASON },
  });
  expect(fixture.read(`payments/${ORDER_ID}`)).toMatchObject({
    status: 'CANCELLED',
    refundAmount: 40_000,
    refundReason: REFUND_REASON,
    refundClaim: null,
  });
  expect(fixture.read(`orderCharges/${CHARGE_ID}`)).toMatchObject({
    status: 'REFUNDED',
    refundedAt: expect.anything(),
    refundReason: REFUND_REASON,
    refundClaim: null,
  });
  expect(fixture.read(`checkoutReservations/${RESERVATION_ID}`)).toMatchObject({
    status: 'RELEASED',
    orderId: ORDER_ID,
    paymentId: ORDER_ID,
  });
  expect(fixture.read(`saleRounds/${ROUND_ID}`)?.counters).toEqual({
    reservedDeliveryAddresses: 0,
    reservedItemQuantity: 0,
    orderedDeliveryAddresses: 0,
    orderedItemQuantity: 0,
    heldOrderCount: 0,
  });
  expect(fixture.read(`saleRoundItems/${ROUND_ITEM_ID}`)).toMatchObject({
    reservedQuantity: 0,
    orderedQuantity: 0,
  });
  expect(fixture.read(`settlements/${ORDER_ID}`)?.status).toBe(settlementStatus);
}

describe('관리자 강제 환불 durable 회차 lifecycle 통합 회귀', () => {
  let fixture: Fixture;
  let app: INestApplication;

  beforeAll(async () => {
    fixture = await createMvpSalesRoundFixture();
    app = fixture.app;
  });

  beforeEach(() => fixture.reset());
  afterAll(async () => app.close());

  it.each([
    ['미인증', undefined, undefined, 401],
    ['consumer', 'consumer-1', 'consumer', 403],
    ['seller', 'seller-1', 'seller', 403],
    ['driver', 'driver-1', 'driver', 403],
  ] as const)('%s 요청은 거부되고 환불·lifecycle side effect가 0이다', async (_label, userId, role, status) => {
    seedRoundRefund(fixture);
    const before = recordSnapshot(fixture);
    const call = request(app.getHttpServer())
      .post(`/admin/orders/${ORDER_ID}/refund`)
      .send({ reason: REFUND_REASON });
    if (userId && role) call.set('x-test-user', userId).set('x-test-role', role);

    await call.expect(status);

    expect(recordSnapshot(fixture)).toEqual(before);
    expect(fixture.portone.refund).not.toHaveBeenCalled();
  });

  it.each([
    'pending',
    'confirmed',
  ] as const)('%s settlement를 포함한 schema-v2 회차 주문은 실제 관리자 HTTP 체인으로 한 번만 환불·반환한다', async (settlementStatus) => {
    seedRoundRefund(fixture, { settlementStatus });

    await adminRefund(fixture).expect(201);

    expect(fixture.portone.refund).toHaveBeenCalledTimes(2);
    expect(fixture.portone.refund).toHaveBeenCalledWith(
      MAIN_PROVIDER_PAYMENT_ID,
      40_000,
      REFUND_REASON,
    );
    expect(fixture.portone.refund).toHaveBeenCalledWith(
      CHARGE_PROVIDER_PAYMENT_ID,
      5_000,
      REFUND_REASON,
    );
    expectRoundCancellation(fixture, 'cancelled');
  });

  it.each([
    'DELIVERED',
    'REVIEWED',
    'PICKED_UP',
  ] as const)('%s 상태는 fail-closed이고 부분 환불·capacity·settlement mutation이 없다', async (orderStatus) => {
    seedRoundRefund(fixture, { orderStatus });
    const before = recordSnapshot(fixture);

    await adminRefund(fixture).expect(403);

    expect(recordSnapshot(fixture)).toEqual(before);
    expect(fixture.portone.refund).not.toHaveBeenCalled();
  });

  it('provider 성공 뒤 local capacity 실패는 재시도 상태를 남기고 provider 환불 intent를 반복하지 않는다', async () => {
    seedRoundRefund(fixture);
    const releaseReservation = jest
      .spyOn(fixture.capacity, 'releaseReservationInTransaction')
      .mockRejectedValueOnce(new Error('예약 반환 실패'));

    try {
      await adminRefund(fixture).expect(500);

      expect(fixture.portone.refund).toHaveBeenCalledTimes(2);
      expect(fixture.read(`orders/${ORDER_ID}`)).toMatchObject({
        status: 'DELIVERY_HELD',
        cancellation: { status: 'LOCAL_FAILED' },
      });
      expect(fixture.read(`payments/${ORDER_ID}`)?.status).toBe('CANCELLED');
      expect(fixture.read(`orderCharges/${CHARGE_ID}`)?.status).toBe('REFUNDED');
      expect(fixture.read(`checkoutReservations/${RESERVATION_ID}`)?.status).toBe('CONSUMED');
      expect(fixture.read(`settlements/${ORDER_ID}`)?.status).toBe('pending');

      await adminRefund(fixture).expect(201);

      expect(fixture.portone.refund).toHaveBeenCalledTimes(2);
      expectRoundCancellation(fixture, 'cancelled');
    } finally {
      releaseReservation.mockRestore();
    }
  });

  it('동시 관리자 환불 요청은 provider·예약·counter를 중복 처리하지 않고 하나의 취소 상태로 수렴한다', async () => {
    seedRoundRefund(fixture);

    const responses = await Promise.all([adminRefund(fixture), adminRefund(fixture)]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 201]);
    expect(fixture.portone.refund).toHaveBeenCalledTimes(2);
    expect(fixture.portone.refund.mock.calls.map(([paymentId]) => paymentId).sort()).toEqual([
      MAIN_PROVIDER_PAYMENT_ID,
      CHARGE_PROVIDER_PAYMENT_ID,
    ]);
    expectRoundCancellation(fixture, 'cancelled');
  });

  it('paid settlement는 관리자 환불 뒤에도 cancelled로 역전되지 않는다', async () => {
    seedRoundRefund(fixture, { settlementStatus: 'paid' });

    await adminRefund(fixture).expect(201);

    expect(fixture.portone.refund).toHaveBeenCalledTimes(2);
    expectRoundCancellation(fixture, 'paid');
  });
});
