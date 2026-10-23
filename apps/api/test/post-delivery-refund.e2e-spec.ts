// 배송 후 환불 HTTP 통합 회귀 — 계획서 post-delivery-refund-plan.md R9.
// 실제 Nest 컨트롤러·가드·DTO 검증·서비스 체인을 메모리 Firestore와 가짜 PortOne으로 구동한다.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { REFUND_NOTICE_REASONS } from '../src/notifications/refund-notice-reasons';
import { createMvpSalesRoundFixture } from './helpers/mvp-sales-round-fixture';

type Fixture = Awaited<ReturnType<typeof createMvpSalesRoundFixture>>;
type Data = Record<string, any>;

const STORE_ID = 'store-1';
const ORDER_ID = 'pdr-order-1';
const ROUND_ID = 'pdr-round-1';
const ROUND_ITEM_ID = 'pdr-item-1';
const RESERVATION_ID = 'pdr-reservation-1';
const CHARGE_ID = 'pdr-charge-1';
const DAY_MS = 24 * 60 * 60 * 1000;
const PROVIDER_REASON = '배송 후 환불(꽃 상함)';
const BODY = {
  reasonCode: 'QUALITY_DAMAGED',
  memo: '받은 날 꽃잎이 시들었다고 사진과 함께 연락 옴',
};

function seedDelivered(
  fixture: Fixture,
  options: { daysAgo?: number; settlementStatus?: string; withCharge?: boolean } = {},
) {
  const counters = {
    reservedDeliveryAddresses: 0,
    reservedItemQuantity: 0,
    orderedDeliveryAddresses: 1,
    orderedItemQuantity: 2,
    heldOrderCount: 0,
  };
  fixture.records.set(`saleRounds/${ROUND_ID}`, {
    id: ROUND_ID,
    storeId: STORE_ID,
    status: 'CLOSED',
    schedule: { orderCloseAt: '2026-10-25T00:00:00.000Z' },
    limits: { maxDeliveryAddresses: 10, maxItemQuantity: 20 },
    counters,
  });
  fixture.records.set(`saleRoundItems/${ROUND_ITEM_ID}`, {
    id: ROUND_ITEM_ID,
    roundId: ROUND_ID,
    storeId: STORE_ID,
    productId: 'product-1',
    orderedQuantity: 2,
    reservedQuantity: 0,
    status: 'ACTIVE',
  });
  fixture.records.set(`checkoutReservations/${RESERVATION_ID}`, {
    id: RESERVATION_ID,
    roundId: ROUND_ID,
    storeId: STORE_ID,
    orderId: ORDER_ID,
    status: 'CONSUMED',
  });
  fixture.records.set(`orders/${ORDER_ID}`, {
    id: ORDER_ID,
    orderNumber: '20261101-000001',
    schemaVersion: 2,
    saleType: 'normal',
    deliveryMethod: 'direct',
    storeId: STORE_ID,
    roundId: ROUND_ID,
    reservationId: RESERVATION_ID,
    userId: 'consumer-1',
    status: 'DELIVERED',
    totalAmount: 40_000,
    orderItems: [{ roundItemId: ROUND_ITEM_ID, quantity: 2 }],
  });
  fixture.records.set(`payments/${ORDER_ID}`, {
    id: ORDER_ID,
    orderId: ORDER_ID,
    storeId: STORE_ID,
    userId: 'consumer-1',
    status: 'PAID',
    amount: 40_000,
    // 가짜 PortOne 재조회는 orders/{paymentId}.totalAmount를 금액으로 돌려준다.
    portonePaymentId: ORDER_ID,
    refundClaim: null,
    refundedAt: null,
  });
  if (options.withCharge) {
    fixture.records.set(`orderCharges/${CHARGE_ID}`, {
      id: CHARGE_ID,
      orderId: ORDER_ID,
      storeId: STORE_ID,
      userId: 'consumer-1',
      type: 'REDELIVERY_FEE',
      status: 'PAID',
      amount: 5_000,
      portonePaymentId: `order-charge-${CHARGE_ID}`,
      refundClaim: null,
      refundedAt: null,
    });
  }
  const settlementStatus = options.settlementStatus ?? 'pending';
  fixture.records.set(`settlements/${ORDER_ID}`, {
    id: ORDER_ID,
    orderId: ORDER_ID,
    storeId: STORE_ID,
    status: settlementStatus,
    totalAmount: 40_000,
    platformFee: 2_000,
    netAmount: 38_000,
    settledAt: new Date(Date.now() - (options.daysAgo ?? 3) * DAY_MS),
    paidAt: settlementStatus === 'paid' ? new Date() : null,
  });
  return counters;
}

function snapshot(fixture: Fixture) {
  return [...fixture.records.entries()]
    .map(([path, data]) => [path, JSON.stringify(data)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
}

function as(call: request.Test, userId: string, role: string) {
  return call.set('x-test-user', userId).set('x-test-role', role);
}

describe('배송 후 환불 HTTP 통합 회귀', () => {
  let fixture: Fixture;
  let app: INestApplication;
  const sellerPath = `/stores/${STORE_ID}/orders/${ORDER_ID}/post-delivery-refund`;
  const adminPath = `/admin/orders/${ORDER_ID}/post-delivery-refund`;

  beforeAll(async () => {
    fixture = await createMvpSalesRoundFixture();
    app = fixture.app;
  });
  beforeEach(() => fixture.reset());
  afterAll(async () => app.close());

  it('판매자가 배송 완료 3일째 주문을 환불하면 결제·재배송비·주문·정산·알림이 맞춰지고 회차 수량은 그대로다', async () => {
    const counters = seedDelivered(fixture, { withCharge: true });

    const eligibility = await as(
      request(app.getHttpServer()).get(sellerPath),
      'seller-1',
      'seller',
    );
    expect(eligibility.status).toBe(200);
    expect(eligibility.body).toMatchObject({ eligible: true, reason: 'OK', amount: 40_000 });

    await as(request(app.getHttpServer()).post(sellerPath), 'seller-1', 'seller')
      .send(BODY)
      .expect(200);

    // 본 결제는 PortOne 상태를 먼저 읽고 한 번 환불한다. 재배송비도 함께 환불한다.
    expect(fixture.portone.getPayment).toHaveBeenCalledWith(ORDER_ID);
    expect(fixture.portone.refund).toHaveBeenCalledTimes(2);
    expect(fixture.portone.refund).toHaveBeenCalledWith(
      ORDER_ID,
      40_000,
      PROVIDER_REASON,
      expect.any(String),
    );
    expect(fixture.read(`orders/${ORDER_ID}`)).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
      postDeliveryRefund: {
        reasonCode: 'QUALITY_DAMAGED',
        actorRole: 'seller',
        actorId: 'seller-1',
        previousStatus: 'DELIVERED',
        amount: 40_000,
        completedAt: expect.any(String),
      },
    });
    expect(fixture.read(`payments/${ORDER_ID}`)).toMatchObject({ status: 'CANCELLED' });
    expect(fixture.read(`orderCharges/${CHARGE_ID}`)).toMatchObject({ status: 'REFUNDED' });
    expect(fixture.read(`settlements/${ORDER_ID}`)?.status).toBe('cancelled');
    expect(fixture.read(`checkoutReservations/${RESERVATION_ID}`)?.status).toBe('CONSUMED');
    expect(fixture.read(`saleRounds/${ROUND_ID}`)?.counters).toEqual(counters);
    expect(fixture.notifications.sendToUser).toHaveBeenCalledWith(
      'consumer-1',
      'ORDER_CANCELLED',
      expect.objectContaining({ reason: REFUND_NOTICE_REASONS.POST_DELIVERY_QUALITY_DAMAGED }),
      ORDER_ID,
      `refund-notice:POST_DELIVERY_QUALITY_DAMAGED:${ORDER_ID}`,
    );
  });

  it.each([
    ['다른 판매자', 'seller-2', 'seller', 403],
    ['소비자', 'consumer-1', 'consumer', 403],
    ['기사', 'driver-1', 'driver', 403],
  ] as const)('%s는 판매자 환불을 할 수 없고 아무것도 바뀌지 않는다', async (_label, userId, role, status) => {
    seedDelivered(fixture);
    const before = snapshot(fixture);

    await as(request(app.getHttpServer()).post(sellerPath), userId, role).send(BODY).expect(status);

    expect(snapshot(fixture)).toEqual(before);
    expect(fixture.portone.refund).not.toHaveBeenCalled();
  });

  it('사유 코드가 없거나 메모에 줄바꿈이 있으면 400이고 아무것도 바뀌지 않는다', async () => {
    seedDelivered(fixture);
    const before = snapshot(fixture);

    await as(request(app.getHttpServer()).post(sellerPath), 'seller-1', 'seller')
      .send({ memo: '사유 없음' })
      .expect(400);
    await as(request(app.getHttpServer()).post(sellerPath), 'seller-1', 'seller')
      .send({ reasonCode: 'BROKEN', memo: '첫 줄\n둘째 줄' })
      .expect(400);

    expect(snapshot(fixture)).toEqual(before);
  });

  it('배송 완료 8일째는 판매자가 거부되고, 같은 주문을 관리자가 환불할 수 있다', async () => {
    seedDelivered(fixture, { daysAgo: 8 });
    const before = snapshot(fixture);

    const eligibility = await as(
      request(app.getHttpServer()).get(sellerPath),
      'seller-1',
      'seller',
    );
    expect(eligibility.body).toMatchObject({ eligible: false, reason: 'WINDOW_EXPIRED' });
    await as(request(app.getHttpServer()).post(sellerPath), 'seller-1', 'seller')
      .send(BODY)
      .expect(403);
    expect(snapshot(fixture)).toEqual(before);

    await as(request(app.getHttpServer()).post(adminPath), 'admin-1', 'admin')
      .send(BODY)
      .expect(200);

    expect(fixture.portone.refund).toHaveBeenCalledTimes(1);
    expect(fixture.read(`orders/${ORDER_ID}`)).toMatchObject({
      status: 'CANCELLED',
      postDeliveryRefund: { actorRole: 'admin', actorId: 'admin-1' },
    });
    expect(fixture.read(`settlements/${ORDER_ID}`)?.status).toBe('cancelled');
    expect(fixture.audit.logAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.order.post_delivery_refunded', targetId: ORDER_ID }),
    );
  });

  it('지급 완료 정산은 관리자 환불 뒤 paid를 유지하고 회수 필요와 관리자만 닫는 운영 기록이 남으며 응답에 회수 금액이 실린다', async () => {
    seedDelivered(fixture, { daysAgo: 10, settlementStatus: 'paid' });

    const response = await as(request(app.getHttpServer()).post(adminPath), 'admin-1', 'admin')
      .send(BODY)
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'CANCELLED',
      recoveryRequired: true,
      recoveryAmount: 38_000,
    });
    expect(fixture.read(`settlements/${ORDER_ID}`)).toMatchObject({
      status: 'paid',
      recoveryRequired: true,
      recoveryAmount: 38_000,
    });
    const issues = [...fixture.records.entries()]
      .filter(([path]) => path.startsWith('operationIssues/'))
      .map(([, data]) => data);
    expect(issues).toEqual([
      expect.objectContaining({
        type: 'SETTLEMENT_RECOVERY_REQUIRED',
        orderId: ORDER_ID,
        status: 'OPEN',
      }),
    ]);
    expect(fixture.audit.logAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.order.post_delivery_refunded',
        after: expect.objectContaining({ recoveryRequired: true, recoveryAmount: 38_000 }),
      }),
    );
  });

  it('PortOne 콘솔에서 이미 취소한 결제는 다시 환불하지 않고 기록만 맞춘다', async () => {
    seedDelivered(fixture, { daysAgo: 9 });
    fixture.portone.getPayment.mockResolvedValueOnce({
      status: 'CANCELLED',
      amount: { total: 40_000 },
      method: { type: 'CARD' },
      transactionId: 'transaction-console',
    } as Data as never);

    await as(request(app.getHttpServer()).post(adminPath), 'admin-1', 'admin')
      .send(BODY)
      .expect(200);

    expect(fixture.portone.refund).not.toHaveBeenCalled();
    expect(fixture.read(`payments/${ORDER_ID}`)).toMatchObject({ status: 'CANCELLED' });
    expect(fixture.read(`orders/${ORDER_ID}`)?.status).toBe('CANCELLED');
  });

  it('같은 판매자 요청을 두 번 보내도 PortOne 환불은 한 번이다', async () => {
    seedDelivered(fixture);

    await as(request(app.getHttpServer()).post(sellerPath), 'seller-1', 'seller')
      .send(BODY)
      .expect(200);
    await as(request(app.getHttpServer()).post(sellerPath), 'seller-1', 'seller')
      .send(BODY)
      .expect(200);

    expect(fixture.portone.refund).toHaveBeenCalledTimes(1);
  });
});
