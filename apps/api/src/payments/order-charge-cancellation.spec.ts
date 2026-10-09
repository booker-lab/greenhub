// 주문 취소와 재배송비 결제가 엇갈릴 때의 정합성.
// - 취소 진행 중에는 새 재배송비 결제를 만들지 않는다.
// - 취소(진행) 뒤 도착한 결제 완료는 PAID로 기록하고 claim 기반으로 환불한다.
// - 결제가 필요한 주문 상태가 아니면 결제를 확정하지 않는다.

import { BadRequestException, ConflictException } from '@nestjs/common';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { MAX_REDELIVERY_FEE_KRW } from '../orders/dto/update-status.dto';
import { OrderChargesService } from '../orders/order-charges.service';
import { OrderChargePaymentService } from './order-charge-payment.service';

type Occ = ReturnType<typeof createOccFirestore>;

const HOLD_AT = '2026-10-01T00:00:00.000Z';
const FEE = 5000;
const ORDER_ID = 'order-1';
const CHARGE_ID = 'charge-1';
const PAYMENT_ID = `order-charge-${CHARGE_ID}`;
const CHARGE_PATH = `orderCharges/${CHARGE_ID}`;

const hold = {
  heldAt: HOLD_AT,
  reasonCode: 'ACCESS_UNAVAILABLE',
  reasonMessage: '배송지 출입 불가',
  customerResponsible: true,
  redeliveryFee: FEE,
  nextContactAt: null,
  nextDeliveryAt: null,
  resolvedAt: null,
};

function seedOrder(occ: Occ, overrides: Record<string, unknown> = {}) {
  occ.seed(`orders/${ORDER_ID}`, {
    id: ORDER_ID,
    storeId: 'store-1',
    userId: 'consumer-1',
    schemaVersion: 2,
    status: 'DELIVERY_HELD',
    deliveryHold: hold,
    redeliveryChargeId: CHARGE_ID,
    redeliveryChargeHoldAt: HOLD_AT,
    ...overrides,
  });
}

function seedCharge(occ: Occ, overrides: Record<string, unknown> = {}) {
  occ.seed(CHARGE_PATH, {
    id: CHARGE_ID,
    orderId: ORDER_ID,
    storeId: 'store-1',
    userId: 'consumer-1',
    type: 'REDELIVERY_FEE',
    status: 'PENDING',
    amount: FEE,
    customerResponsible: true,
    holdAt: HOLD_AT,
    portonePaymentId: PAYMENT_ID,
    ...overrides,
  });
}

function makePaymentService(occ: Occ) {
  const portone = {
    getPayment: jest.fn().mockResolvedValue({
      id: PAYMENT_ID,
      status: 'PAID',
      amount: { total: FEE },
      method: { type: 'CARD' },
      transactionId: 'tx-1',
    }),
    refund: jest.fn().mockResolvedValue(undefined),
  };
  const service = new OrderChargePaymentService(occ.firestore as never, portone as never);
  return { service, portone };
}

describe('취소 주문의 재배송비 결제 완료 처리', () => {
  it('취소된 주문에 늦게 도착한 결제 완료는 PAID로 기록한 뒤 한 번 환불한다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, {
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
      deliveryHold: { ...hold, resolvedAt: '2026-10-02T00:00:00.000Z' },
    });
    seedCharge(occ);
    const { service, portone } = makePaymentService(occ);

    await expect(service.handleWebhook('Transaction.Paid', PAYMENT_ID)).resolves.toEqual({
      ok: true,
      status: 'PAID',
      reason: 'cancelled_order_refund',
    });

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledWith(
      PAYMENT_ID,
      FEE,
      expect.any(String),
      expect.any(String),
    );
    expect(occ.getData(CHARGE_PATH)).toMatchObject({
      status: 'REFUNDED',
      portoneTransactionId: 'tx-1',
      paidAt: expect.anything(),
      refundedAt: expect.anything(),
    });
  });

  it.each([
    'REFUNDING',
    'LOCAL_PENDING',
    'LOCAL_FAILED',
    'REFUND_FAILED',
  ])('취소가 %s 상태로 진행 중이면 결제를 주문에 반영하지 않고 환불한다', async (cancellationStatus) => {
    const occ = createOccFirestore();
    seedOrder(occ, { cancellation: { status: cancellationStatus } });
    seedCharge(occ);
    const { service, portone } = makePaymentService(occ);

    await service.handleWebhook('Transaction.Paid', PAYMENT_ID);

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData(CHARGE_PATH)).toMatchObject({ status: 'REFUNDED' });
  });

  it('환불 전에 멈춘 PAID 결제는 같은 웹훅 재전송에서 환불을 이어 간다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, { status: 'CANCELLED', cancellation: { status: 'COMPLETED' } });
    seedCharge(occ, { status: 'PAID', paidAt: '2026-10-02T00:00:00.000Z' });
    const { service, portone } = makePaymentService(occ);

    await expect(service.handleWebhook('Transaction.Paid', PAYMENT_ID)).resolves.toEqual({
      ok: true,
      reason: 'already_processed',
    });

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData(CHARGE_PATH)).toMatchObject({ status: 'REFUNDED' });
  });

  it('취소되지 않은 주문의 PAID 결제는 재전송돼도 환불하지 않는다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, { status: 'PREPARING' });
    seedCharge(occ, { status: 'PAID' });
    const { service, portone } = makePaymentService(occ);

    await service.handleWebhook('Transaction.Paid', PAYMENT_ID);

    expect(portone.refund).not.toHaveBeenCalled();
    expect(occ.getData(CHARGE_PATH)).toMatchObject({ status: 'PAID' });
  });

  it('결제가 필요한 주문 상태(보류·재개 대기)가 아니면 결제를 확정하지 않는다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, { status: 'DELIVERED' });
    seedCharge(occ);
    const { service, portone } = makePaymentService(occ);

    await expect(service.handleWebhook('Transaction.Paid', PAYMENT_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(portone.refund).not.toHaveBeenCalled();
    expect(occ.getData(CHARGE_PATH)).toMatchObject({ status: 'PENDING' });
  });
});

describe('재배송비 결제 생성 경계', () => {
  function makeChargesService(occ: Occ) {
    const issueWriter = { createOrMergeIssue: jest.fn() };
    return new OrderChargesService(occ.firestore as never, issueWriter as never);
  }

  it('취소가 진행 중인 주문에는 재배송비 결제를 만들지 않는다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, {
      redeliveryChargeId: undefined,
      redeliveryChargeHoldAt: undefined,
      cancellation: { status: 'REFUNDING' },
    });
    const service = makeChargesService(occ);

    await expect(
      service.createRedeliveryFeeCharge({
        storeId: 'store-1',
        orderId: ORDER_ID,
        requesterId: 'consumer-1',
        idempotencyKey: 'key-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(occ.listData('orderCharges/')).toHaveLength(0);
  });

  it.each([
    MAX_REDELIVERY_FEE_KRW + 1,
    1500.5,
  ])('보류에 저장된 재배송비 %p원은 결제 금액으로 쓰지 않는다', async (fee) => {
    const occ = createOccFirestore();
    seedOrder(occ, {
      deliveryHold: { ...hold, redeliveryFee: fee },
      redeliveryChargeId: undefined,
      redeliveryChargeHoldAt: undefined,
    });
    const service = makeChargesService(occ);

    await expect(
      service.createRedeliveryFeeCharge({
        storeId: 'store-1',
        orderId: ORDER_ID,
        requesterId: 'consumer-1',
        idempotencyKey: 'key-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(occ.listData('orderCharges/')).toHaveLength(0);
  });
});
