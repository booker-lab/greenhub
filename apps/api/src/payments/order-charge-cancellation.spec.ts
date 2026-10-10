// 주문 취소와 재배송비 결제가 엇갈릴 때의 정합성.
// - 취소 진행 중에는 새 재배송비 결제를 만들지 않는다.
// - 취소(진행) 뒤 도착한 결제 완료는 PAID로 기록하고 claim 기반으로 환불한다.
// - 결제가 필요한 주문 상태가 아니거나 현재 보류에 연결되지 않은 결제는 주문에 반영하지 않고 기록한 뒤 환불한다.
// - 실패 웹훅 뒤 PortOne이 확정한 결제는 현재 보류의 결제로 반영한다.
// - 이미 환불된 결제의 재전송은 처리 완료로 답하고, 멈춘 환불 claim은 재시도 응답으로 이어 간다.

import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
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

  it('이미 환불된 결제의 결제 완료 재전송은 처리 완료로 답하고 다시 환불하지 않는다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, { status: 'CANCELLED', cancellation: { status: 'COMPLETED' } });
    seedCharge(occ, {
      status: 'REFUNDED',
      paidAt: '2026-10-02T00:00:00.000Z',
      refundedAt: '2026-10-02T00:01:00.000Z',
      refundClaim: null,
    });
    const { service, portone } = makePaymentService(occ);

    await expect(service.handleWebhook('Transaction.Paid', PAYMENT_ID)).resolves.toEqual({
      ok: true,
      reason: 'already_processed',
    });

    expect(portone.refund).not.toHaveBeenCalled();
    expect(occ.getData(CHARGE_PATH)).toMatchObject({ status: 'REFUNDED' });
  });

  it('환불 claim을 쥔 시도가 멈추면 재전송에 재시도 응답을 주고, 만료 뒤 같은 키로 환불을 끝낸다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, { status: 'CANCELLED', cancellation: { status: 'COMPLETED' } });
    // 앞선 시도가 claim만 남기고 환불 POST·UNKNOWN 기록 전에 멈춘 상태.
    const stalledClaim = {
      token: 'stalled-token',
      owner: 'order-charge-refund',
      status: 'CLAIMED',
      providerKey: 'order-charge-refund-stalled-key',
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
    seedCharge(occ, {
      status: 'PAID',
      paidAt: '2026-10-02T00:00:00.000Z',
      refundClaim: stalledClaim,
    });
    const { service, portone } = makePaymentService(occ);

    await expect(service.handleWebhook('Transaction.Paid', PAYMENT_ID)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(portone.refund).not.toHaveBeenCalled();
    expect(occ.getData(CHARGE_PATH)).toMatchObject({ status: 'PAID', refundClaim: stalledClaim });

    // claim이 만료되면 다음 재전송이 takeover해 provider 상태를 확인한 뒤 환불한다.
    occ.updateOutsideTransaction(CHARGE_PATH, {
      refundClaim: { ...stalledClaim, expiresAt: Date.now() - 1 },
    });
    await expect(service.handleWebhook('Transaction.Paid', PAYMENT_ID)).resolves.toEqual({
      ok: true,
      reason: 'already_processed',
    });
    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(portone.refund).toHaveBeenCalledWith(
      PAYMENT_ID,
      FEE,
      expect.any(String),
      stalledClaim.providerKey,
    );
    expect(occ.getData(CHARGE_PATH)).toMatchObject({
      status: 'REFUNDED',
      refundedAt: expect.anything(),
      refundClaim: null,
    });
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

  it('결제가 필요한 주문 상태(보류·재개 대기)가 아니면 주문에 반영하지 않고 결제를 기록한 뒤 환불한다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, { status: 'DELIVERED' });
    seedCharge(occ);
    const { service, portone } = makePaymentService(occ);

    await expect(service.handleWebhook('Transaction.Paid', PAYMENT_ID)).resolves.toEqual({
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
  });

  it('보류가 다른 보류로 바뀐 뒤 이전 청구로 결제하면 환불한다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, {
      deliveryHold: { ...hold, heldAt: '2026-10-03T00:00:00.000Z' },
      redeliveryChargeId: 'charge-2',
      redeliveryChargeHoldAt: '2026-10-03T00:00:00.000Z',
    });
    seedCharge(occ);
    const { service, portone } = makePaymentService(occ);

    await service.handleWebhook('Transaction.Paid', PAYMENT_ID);

    expect(portone.refund).toHaveBeenCalledTimes(1);
    expect(occ.getData(CHARGE_PATH)).toMatchObject({ status: 'REFUNDED' });
    expect(occ.getData(`orders/${ORDER_ID}`)).toMatchObject({ redeliveryChargeId: 'charge-2' });
  });

  it('실패 웹훅 뒤 PortOne이 결제를 확정하면 현재 보류의 결제로 반영한다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ);
    seedCharge(occ, { status: 'FAILED', failedAt: '2026-10-02T00:00:00.000Z' });
    const { service, portone } = makePaymentService(occ);

    await expect(service.handleWebhook('Transaction.Paid', PAYMENT_ID)).resolves.toEqual({
      ok: true,
      status: 'PAID',
    });
    expect(portone.refund).not.toHaveBeenCalled();
    expect(occ.getData(CHARGE_PATH)).toMatchObject({ status: 'PAID', failedAt: null });
  });

  it('필요 없어진 결제의 환불이 실패하면 같은 결제 완료 재전송에서 환불을 이어 간다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, { status: 'DELIVERED' });
    seedCharge(occ);
    const { service, portone } = makePaymentService(occ);
    portone.refund.mockRejectedValueOnce(new Error('provider timeout'));

    await expect(service.handleWebhook('Transaction.Paid', PAYMENT_ID)).rejects.toThrow(
      'provider timeout',
    );
    expect(occ.getData(CHARGE_PATH)).toMatchObject({
      status: 'PAID',
      refundClaim: expect.objectContaining({ status: 'UNKNOWN' }),
    });

    await expect(service.handleWebhook('Transaction.Paid', PAYMENT_ID)).resolves.toEqual({
      ok: true,
      reason: 'already_processed',
    });
    expect(portone.refund).toHaveBeenCalledTimes(2);
    expect(occ.getData(CHARGE_PATH)).toMatchObject({ status: 'REFUNDED' });
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
