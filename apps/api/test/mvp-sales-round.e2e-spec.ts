import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createMvpSalesRoundFixture } from './helpers/mvp-sales-round-fixture';

type Fixture = Awaited<ReturnType<typeof createMvpSalesRoundFixture>>;

describe('회차 직배송 서버 전체 흐름 통합 계약', () => {
  let fixture: Fixture;
  let app: INestApplication;

  beforeAll(async () => {
    fixture = await createMvpSalesRoundFixture();
    app = fixture.app;
  });

  beforeEach(() => fixture.reset());
  afterAll(async () => app.close());

  function asUser<T extends request.Test>(call: T, userId: string, role: string): T {
    return call.set('x-test-user', userId).set('x-test-role', role) as T;
  }

  function roundInput(maxDeliveryAddresses = 3, maxItemQuantity = 10) {
    const now = Date.now();
    const iso = (offsetHours: number) => new Date(now + offsetHours * 3_600_000).toISOString();
    return {
      name: '2026년 7월 넷째 주',
      schedule: {
        orderOpenAt: iso(-2),
        orderCloseAt: iso(2),
        auctionAt: iso(3),
        deliveryStartAt: iso(4),
        deliveryEndAt: iso(5),
        timezone: 'Asia/Seoul',
      },
      deliveryRegion: {
        id: 'icheon',
        label: '경기도 이천시',
        province: '경기도',
        city: '이천시',
        enabled: true,
      },
      limits: { maxDeliveryAddresses, maxItemQuantity },
      items: [
        {
          productId: 'product-1',
          roundPrice: 20_000,
          saleLimitQuantity: maxItemQuantity,
          displayOrder: 0,
        },
      ],
    };
  }

  async function createOpenRound(maxDeliveryAddresses = 3, maxItemQuantity = 10) {
    const created = await asUser(
      request(app.getHttpServer()).post('/stores/store-1/sale-rounds'),
      'seller-1',
      'seller',
    )
      .send(roundInput(maxDeliveryAddresses, maxItemQuantity))
      .expect(201);
    const roundId = created.body.id as string;
    const roundItemId = created.body.items[0].id as string;

    await asUser(
      request(app.getHttpServer()).patch(`/stores/store-1/sale-rounds/${roundId}/status`),
      'seller-1',
      'seller',
    )
      .send({ status: 'SCHEDULED' })
      .expect(200);
    await asUser(
      request(app.getHttpServer()).patch(`/stores/store-1/sale-rounds/${roundId}/status`),
      'seller-1',
      'seller',
    )
      .send({ status: 'OPEN' })
      .expect(200);
    return { roundId, roundItemId };
  }

  function orderInput(
    roundId: string,
    roundItemId: string,
    clientOrderRequestId: string,
    quantity = 1,
  ) {
    return {
      clientOrderRequestId,
      productId: 'product-1',
      quantity,
      saleType: 'normal',
      deliveryMethod: 'direct',
      requestedDeliveryDate: new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10),
      roundId,
      roundItems: [{ roundItemId, quantity }],
      deliveryPhone: '010-1111-1111',
      deliveryAddress: {
        address: '경기도 이천시 중리천로 1',
        addressDetail: '101호',
        zipCode: '17373',
      },
      marketingConsent: {
        agreed: true,
        channels: ['alimtalk'],
        copyVersion: '2026-07',
        agreedAt: new Date().toISOString(),
      },
    };
  }

  async function paidWebhook(paymentId: string, webhookId: string) {
    return request(app.getHttpServer())
      .post('/payments/webhook/portone')
      .set('webhook-id', webhookId)
      .set('webhook-timestamp', String(Math.floor(Date.now() / 1000)))
      .set('webhook-signature', 'v1,contract-signature')
      .send({
        type: 'Transaction.Paid',
        data: { paymentId, storeId: 'store-1' },
      })
      .expect(200);
  }

  it('인증 없음·소비자·다른 판매자의 회차 관리 요청을 서로 다른 경계에서 거부한다', async () => {
    await request(app.getHttpServer())
      .post('/stores/store-1/sale-rounds')
      .send(roundInput())
      .expect(401);
    await asUser(
      request(app.getHttpServer()).post('/stores/store-1/sale-rounds'),
      'consumer-1',
      'consumer',
    )
      .send(roundInput())
      .expect(403);
    await asUser(
      request(app.getHttpServer()).post('/stores/store-1/sale-rounds'),
      'seller-2',
      'seller',
    )
      .send(roundInput())
      .expect(403);
  });

  it('회차 개설부터 유료 재배송 결제와 미결제 재개 차단까지 멱등 연결한다', async () => {
    const { roundId, roundItemId } = await createOpenRound();
    const body = orderInput(roundId, roundItemId, 'checkout-main-001');

    const created = await asUser(
      request(app.getHttpServer()).post('/stores/store-1/orders'),
      'consumer-1',
      'consumer',
    )
      .send(body)
      .expect(201);
    const orderId = created.body.orderId as string;
    const reservationId = created.body.reservationId as string;
    const duplicate = await asUser(
      request(app.getHttpServer()).post('/stores/store-1/orders'),
      'consumer-1',
      'consumer',
    )
      .send(body)
      .expect(201);

    expect(duplicate.body.orderId).toBe(orderId);
    expect(fixture.read(`checkoutReservations/${reservationId}`)).toMatchObject({
      status: 'HELD',
      itemQuantityTotal: 1,
    });
    expect(fixture.read(`saleRounds/${roundId}`)?.counters.reservedItemQuantity).toBe(1);

    await request(app.getHttpServer())
      .post('/payments/webhook/portone')
      .send({ type: 'Transaction.Paid', data: { paymentId: orderId, storeId: 'store-1' } })
      .expect(401);
    await paidWebhook(orderId, 'webhook-order-paid-1');
    await paidWebhook(orderId, 'webhook-order-paid-duplicate');
    expect(fixture.read(`orders/${orderId}`)).toMatchObject({ status: 'ACCEPTED' });
    expect(fixture.read(`checkoutReservations/${reservationId}`)).toMatchObject({
      status: 'CONSUMED',
      orderId,
      paymentId: orderId,
    });
    expect(fixture.notifications.sendToUser).toHaveBeenCalledTimes(1);

    await asUser(
      request(app.getHttpServer()).patch(`/stores/store-1/sale-rounds/${roundId}/status`),
      'seller-1',
      'seller',
    )
      .send({ status: 'CLOSED' })
      .expect(200);
    await asUser(
      request(app.getHttpServer()).patch(`/stores/store-1/orders/${orderId}/status`),
      'seller-1',
      'seller',
    )
      .send({ status: 'PREPARING', preparedAt: new Date().toISOString() })
      .expect(200);
    await asUser(
      request(app.getHttpServer()).patch(`/stores/store-1/orders/${orderId}/status`),
      'driver-1',
      'driver',
    )
      .send({ status: 'DELIVERING' })
      .expect(200);

    const hold = {
      deliveryHold: {
        reasonCode: 'ACCESS_UNAVAILABLE',
        reasonMessage: '공동현관 출입 불가',
        customerResponsible: true,
        redeliveryFee: 5_000,
        nextContactAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    };
    await asUser(
      request(app.getHttpServer()).patch(`/stores/store-1/orders/${orderId}/delivery-hold`),
      'driver-1',
      'driver',
    )
      .send(hold)
      .expect(200);
    expect(fixture.read(`saleRounds/${roundId}`)?.counters.heldOrderCount).toBe(1);
    await asUser(
      request(app.getHttpServer()).patch(`/stores/store-1/sale-rounds/${roundId}/complete`),
      'seller-1',
      'seller',
    ).expect(409);

    const charge = await asUser(
      request(app.getHttpServer()).post(`/stores/store-1/orders/${orderId}/redelivery-fee`),
      'consumer-1',
      'consumer',
    )
      .send({ idempotencyKey: 'redelivery-main-001' })
      .expect(200);
    const duplicateCharge = await asUser(
      request(app.getHttpServer()).post(`/stores/store-1/orders/${orderId}/redelivery-fee`),
      'consumer-1',
      'consumer',
    )
      .send({ idempotencyKey: 'redelivery-main-001' })
      .expect(200);
    expect(duplicateCharge.body.id).toBe(charge.body.id);
    await paidWebhook(charge.body.portonePaymentId, 'webhook-charge-paid-1');
    await paidWebhook(charge.body.portonePaymentId, 'webhook-charge-paid-duplicate');
    expect(fixture.read(`orderCharges/${charge.body.id}`)?.status).toBe('PAID');

    await asUser(
      request(app.getHttpServer()).patch(`/stores/store-1/orders/${orderId}/status`),
      'driver-1',
      'driver',
    )
      .send({ status: 'DELIVERING' })
      .expect(200);
    await asUser(
      request(app.getHttpServer()).patch(`/stores/store-1/orders/${orderId}/delivery-hold`),
      'driver-1',
      'driver',
    )
      .send({ ...hold, deliveryHold: { ...hold.deliveryHold, reasonMessage: '재배송 출입 실패' } })
      .expect(200);
    await asUser(
      request(app.getHttpServer()).post(`/stores/store-1/orders/${orderId}/redelivery-fee`),
      'consumer-1',
      'consumer',
    )
      .send({ idempotencyKey: 'redelivery-second-001' })
      .expect(200);
    expect(fixture.read(`orders/${orderId}`)).toMatchObject({
      requiresOperationalReview: true,
      status: 'DELIVERY_HELD',
    });
    expect(
      [...fixture.records.entries()].filter(
        ([path, value]) =>
          path.startsWith('operationIssues/') && value.type === 'REDELIVERY_FAILED',
      ),
    ).toHaveLength(1);

    await asUser(
      request(app.getHttpServer()).patch(`/stores/store-1/orders/${orderId}/status`),
      'driver-1',
      'driver',
    )
      .send({ status: 'DELIVERING' })
      .expect(409);
    expect(fixture.read(`orders/${orderId}`)).toMatchObject({
      status: 'DELIVERY_HELD',
      requiresOperationalReview: true,
      deliveryHold: expect.objectContaining({ resolvedAt: null }),
    });
    expect(fixture.read(`saleRounds/${roundId}`)?.counters.heldOrderCount).toBe(1);
  });

  it('회차 한도 초과와 늦은 결제를 실제 예약 재확보 실패 후 한 번만 환불한다', async () => {
    const { roundId, roundItemId } = await createOpenRound(1, 1);
    await asUser(
      request(app.getHttpServer()).post('/stores/store-1/orders'),
      'consumer-1',
      'consumer',
    )
      .send(orderInput(roundId, roundItemId, 'checkout-over-capacity', 2))
      .expect(409);

    const lateOrder = await asUser(
      request(app.getHttpServer()).post('/stores/store-1/orders'),
      'consumer-1',
      'consumer',
    )
      .send(orderInput(roundId, roundItemId, 'checkout-late-payment'))
      .expect(201);
    await fixture.finalization.cancelPendingOrder(lateOrder.body.orderId, 'timeout');

    await asUser(
      request(app.getHttpServer()).post('/stores/store-1/orders'),
      'consumer-2',
      'consumer',
    )
      .send(orderInput(roundId, roundItemId, 'checkout-capacity-winner'))
      .expect(201);

    await paidWebhook(lateOrder.body.orderId, 'webhook-late-paid-1');
    await paidWebhook(lateOrder.body.orderId, 'webhook-late-paid-duplicate');
    expect(fixture.read(`orders/${lateOrder.body.orderId}`)).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'timeout',
    });
    expect(fixture.read(`payments/${lateOrder.body.orderId}`)).toMatchObject({
      status: 'CANCELLED',
      refundReason: '결제 만료 후 회차 한도 마감',
    });
    expect(fixture.portone.refund).toHaveBeenCalledTimes(1);
  });
});
