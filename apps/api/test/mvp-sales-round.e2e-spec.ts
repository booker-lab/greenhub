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
    return call.set('x-test-user', userId).set('x-test-role', role);
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

  // 결제된 회차 주문을 고객 책임 유료 보류로 만들고 재배송비 청구를 만든다(재배송비 웹훅은 보내지 않는다).
  async function createHeldOrderWithCharge(key: string) {
    const { roundId, roundItemId } = await createOpenRound();
    const created = await asUser(
      request(app.getHttpServer()).post('/stores/store-1/orders'),
      'consumer-1',
      'consumer',
    )
      .send(orderInput(roundId, roundItemId, `checkout-${key}`))
      .expect(201);
    const orderId = created.body.orderId as string;
    await paidWebhook(orderId, `webhook-${key}-order`);
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
    await asUser(
      request(app.getHttpServer()).patch(`/stores/store-1/orders/${orderId}/delivery-hold`),
      'driver-1',
      'driver',
    )
      .send({
        deliveryHold: {
          reasonCode: 'ACCESS_UNAVAILABLE',
          reasonMessage: '공동현관 출입 불가',
          customerResponsible: true,
          redeliveryFee: 5_000,
          nextContactAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      })
      .expect(200);
    const charge = await asUser(
      request(app.getHttpServer()).post(`/stores/store-1/orders/${orderId}/redelivery-fee`),
      'consumer-1',
      'consumer',
    )
      .send({ idempotencyKey: `redelivery-${key}-001` })
      .expect(200);
    const chargeId = charge.body.id as string;
    return { orderId, chargeId, paymentId: charge.body.portonePaymentId as string };
  }

  it('재배송비 결제 웹훅이 빠져도 웹훅 밖 확인이 PortOne PAID로 확정해 재배송을 재개한다', async () => {
    const { orderId, chargeId, paymentId } = await createHeldOrderWithCharge('charge-no-webhook');
    const charge = { body: { portonePaymentId: paymentId } };

    // 손님은 PortOne에서 결제를 마쳤지만 Transaction.Paid 웹훅이 오지 않았다.
    // 결제 전에는 재배송을 재개할 수 없다.
    await asUser(
      request(app.getHttpServer()).patch(`/stores/store-1/orders/${orderId}/status`),
      'driver-1',
      'driver',
    )
      .send({ status: 'DELIVERING' })
      .expect(409);

    // 15분이 안 됐으면 조회하지 않는다.
    await fixture.chargePayments.reconcilePendingCharges();
    expect(fixture.portone.getPayment).not.toHaveBeenCalledWith(charge.body.portonePaymentId);
    expect(fixture.read(`orderCharges/${chargeId}`)?.status).toBe('PENDING');

    const realNow = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(realNow + 16 * 60 * 1000);
    try {
      await fixture.chargePayments.reconcilePendingCharges();
    } finally {
      clock.mockRestore();
    }
    expect(fixture.portone.getPayment).toHaveBeenCalledWith(charge.body.portonePaymentId);
    expect(fixture.read(`orderCharges/${chargeId}`)).toMatchObject({
      status: 'PAID',
      portoneTransactionId: `transaction-${charge.body.portonePaymentId}`,
    });
    expect(fixture.portone.refund).not.toHaveBeenCalled();

    // 늦게 온 웹훅은 다시 반영하지 않는다.
    await paidWebhook(charge.body.portonePaymentId, 'webhook-charge-no-webhook-late');
    expect(fixture.read(`orderCharges/${chargeId}`)?.status).toBe('PAID');
    await asUser(
      request(app.getHttpServer()).patch(`/stores/store-1/orders/${orderId}/status`),
      'driver-1',
      'driver',
    )
      .send({ status: 'DELIVERING' })
      .expect(200);
  });

  it('주문 상세의 재배송비 결제 확인이 웹훅 없이 확정하고 다른 손님은 거부한다', async () => {
    const { orderId, chargeId, paymentId } = await createHeldOrderWithCharge('charge-customer-check');
    const path = `/payments/orders/${orderId}/redelivery-charge/check`;

    await request(app.getHttpServer()).post(path).expect(401);
    await asUser(request(app.getHttpServer()).post(path), 'consumer-2', 'consumer').expect(403);
    expect(fixture.portone.getPayment).not.toHaveBeenCalledWith(paymentId);

    const checked = await asUser(request(app.getHttpServer()).post(path), 'consumer-1', 'consumer')
      .send()
      .expect(200);
    expect(checked.body).toEqual({ status: 'PAID', result: 'finalized' });
    expect(fixture.read(`orderCharges/${chargeId}`)).toMatchObject({ status: 'PAID' });
    expect(fixture.portone.refund).not.toHaveBeenCalled();

    // 이미 확정된 뒤에는 PortOne을 다시 조회하지 않는다.
    fixture.portone.getPayment.mockClear();
    const again = await asUser(request(app.getHttpServer()).post(path), 'consumer-1', 'consumer')
      .send()
      .expect(200);
    expect(again.body).toEqual({ status: 'PAID', result: 'not_pending' });
    expect(fixture.portone.getPayment).not.toHaveBeenCalled();

    await asUser(
      request(app.getHttpServer()).patch(`/stores/store-1/orders/${orderId}/status`),
      'driver-1',
      'driver',
    )
      .send({ status: 'DELIVERING' })
      .expect(200);
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

  it('웹훅 없이도 결제 완료 화면의 결제 확인이 PortOne PAID 주문을 한 번만 확정한다', async () => {
    const { roundId, roundItemId } = await createOpenRound();
    const created = await asUser(
      request(app.getHttpServer()).post('/stores/store-1/orders'),
      'consumer-1',
      'consumer',
    )
      .send(orderInput(roundId, roundItemId, 'checkout-check-001'))
      .expect(201);
    const orderId = created.body.orderId as string;
    const reservationId = created.body.reservationId as string;
    const check = (userId: string, role: string) =>
      asUser(request(app.getHttpServer()).post(`/payments/orders/${orderId}/check`), userId, role);

    // 로그인 없음·다른 손님·관리자는 주문을 확인할 수 없다.
    await request(app.getHttpServer()).post(`/payments/orders/${orderId}/check`).expect(401);
    await check('consumer-2', 'consumer').expect(403);
    await check('admin-1', 'admin').expect(403);
    expect(fixture.portone.getPayment).not.toHaveBeenCalled();

    // 결제창이 아직 진행 중이면 주문을 바꾸지 않는다(취소하지 않는다).
    fixture.portone.getPayment.mockResolvedValueOnce({
      status: 'READY',
      amount: { total: 0 },
      method: { type: 'CARD' },
      transactionId: 'transaction-ready',
    });
    await check('consumer-1', 'consumer')
      .expect(200)
      .expect({ status: 'PENDING', result: 'not_paid' });
    // 같은 주문을 곧바로 다시 확인하면 PortOne을 다시 조회하지 않는다.
    await check('consumer-1', 'consumer')
      .expect(200)
      .expect({ status: 'PENDING', result: 'throttled' });
    expect(fixture.portone.getPayment).toHaveBeenCalledTimes(1);
    expect(fixture.read(`orders/${orderId}`)).toMatchObject({ status: 'PENDING' });
    expect(fixture.read(`checkoutReservations/${reservationId}`)).toMatchObject({ status: 'HELD' });

    // 간격이 지난 뒤 PortOne이 PAID라고 답하면 웹훅 없이 확정한다.
    const order = fixture.records.get(`orders/${orderId}`) as Record<string, unknown>;
    fixture.records.set(`orders/${orderId}`, {
      ...order,
      paymentCheckRequestedAtMs: Date.now() - 10_000,
    });
    await check('consumer-1', 'consumer')
      .expect(200)
      .expect({ status: 'ACCEPTED', result: 'finalized' });
    const read = await asUser(
      request(app.getHttpServer()).get(`/orders/${orderId}`),
      'consumer-1',
      'consumer',
    ).expect(200);
    expect(read.body.status).toBe('ACCEPTED');
    expect(fixture.read(`checkoutReservations/${reservationId}`)).toMatchObject({
      status: 'CONSUMED',
      orderId,
    });
    expect(fixture.read(`payments/${orderId}`)).toMatchObject({ status: 'PAID' });

    // 늦게 온 웹훅과 다시 누른 확인은 아무것도 다시 확정하지 않는다.
    await paidWebhook(orderId, 'webhook-order-paid-after-check');
    await check('consumer-1', 'consumer')
      .expect(200)
      .expect({ status: 'ACCEPTED', result: 'not_pending' });
    expect(fixture.read(`orders/${orderId}`)).toMatchObject({ status: 'ACCEPTED' });
    expect(fixture.notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(fixture.portone.refund).not.toHaveBeenCalled();
  });
});
