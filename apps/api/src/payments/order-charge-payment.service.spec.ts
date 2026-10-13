// 재배송비 Paid 웹훅 확정 전 확인.
// - 주문 결제 확정과 같은 상점·통화·채널 정책(portone-payment-context)을 쓴다.
// - PortOne이 승인한 결제가 청구와 맞지 않으면 청구를 PAID로 바꾸지 않고 400으로 답하며,
//   같은 청구·결제 ID에 하나로 합쳐지는 운영 확인 기록을 남긴다.

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import { OrderChargePaymentService } from './order-charge-payment.service';

type Occ = ReturnType<typeof createOccFirestore>;

const HOLD_AT = '2026-10-01T00:00:00.000Z';
const FEE = 5000;
const ORDER_ID = 'order-1';
const CHARGE_ID = 'charge-1';
const PAYMENT_ID = `order-charge-${CHARGE_ID}`;
const CHARGE_PATH = `orderCharges/${CHARGE_ID}`;

const productionConfig = {
  RAILWAY_ENVIRONMENT_NAME: 'production',
  PORTONE_STORE_ID: 'store-portone-live',
};
const stagingConfig = {
  RAILWAY_ENVIRONMENT_NAME: 'staging',
  PORTONE_STORE_ID: 'store-portone-live',
};
const livePayment = {
  storeId: 'store-portone-live',
  currency: 'KRW',
  channel: { type: 'LIVE' },
};

function seed(occ: Occ, chargeOverrides: Record<string, unknown> = {}) {
  occ.seed(`orders/${ORDER_ID}`, {
    id: ORDER_ID,
    storeId: 'store-1',
    userId: 'consumer-1',
    schemaVersion: 2,
    status: 'DELIVERY_HELD',
    deliveryHold: {
      heldAt: HOLD_AT,
      customerResponsible: true,
      redeliveryFee: FEE,
      resolvedAt: null,
    },
    redeliveryChargeId: CHARGE_ID,
    redeliveryChargeHoldAt: HOLD_AT,
  });
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
    ...chargeOverrides,
  });
}

function makeService(
  payment: Record<string, unknown>,
  configValues?: Record<string, string>,
  options: { withIssueWriter?: boolean } = {},
) {
  const occ = createOccFirestore();
  seed(occ);
  const portone = {
    getPayment: jest.fn().mockResolvedValue({
      id: PAYMENT_ID,
      status: 'PAID',
      amount: { total: FEE },
      method: { type: 'CARD' },
      transactionId: 'tx-1',
      ...payment,
    }),
    refund: jest.fn().mockResolvedValue(undefined),
  };
  const issueWriter = new OperationIssueWriterService(occ.firestore as never);
  const createOrMergeIssue = jest.spyOn(issueWriter, 'createOrMergeIssue');
  const service = new OrderChargePaymentService(
    occ.firestore as never,
    portone as never,
    options.withIssueWriter === false ? undefined : issueWriter,
    configValues ? new ConfigService(configValues) : undefined,
  );
  return { occ, portone, service, createOrMergeIssue };
}

describe('재배송비 결제 확정 전 상점·통화·채널 확인', () => {
  it('운영에서 상점·KRW·LIVE 채널이 맞으면 기존처럼 PAID로 확정한다', async () => {
    const fixture = makeService(livePayment, productionConfig);

    await expect(fixture.service.handleWebhook('Transaction.Paid', PAYMENT_ID)).resolves.toEqual({
      ok: true,
      status: 'PAID',
    });

    expect(fixture.occ.getData(CHARGE_PATH)?.['status']).toBe('PAID');
    expect(fixture.createOrMergeIssue).not.toHaveBeenCalled();
  });

  it.each([
    ['운영 TEST 채널', { channel: { type: 'TEST' } }, 'channel.type'],
    ['다른 상점', { storeId: 'store-other' }, 'storeId'],
    ['KRW가 아닌 통화', { currency: 'USD' }, 'currency'],
    ['채널 정보 없음', { channel: undefined }, 'channel.type'],
    ['통화 정보 없음', { currency: undefined }, 'currency'],
  ])('%s 결제는 확정하지 않고 운영 확인 기록을 남긴다', async (_name, override, field) => {
    const fixture = makeService({ ...livePayment, ...override }, productionConfig);

    await expect(
      fixture.service.handleWebhook('Transaction.Paid', PAYMENT_ID),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fixture.occ.getData(CHARGE_PATH)).toMatchObject({ status: 'PENDING' });
    expect(fixture.occ.getData(CHARGE_PATH)?.['paidAt']).toBeUndefined();
    expect(fixture.portone.refund).not.toHaveBeenCalled();
    expect(fixture.createOrMergeIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 'store-1',
        orderId: ORDER_ID,
        paymentId: null,
        chargeId: CHARGE_ID,
        type: 'PAYMENT_LOOKUP_FAILED',
        severity: 'critical',
        idempotencyKey: `charge-payment-mismatch:${CHARGE_ID}:${PAYMENT_ID}`,
        latestSnapshot: {
          chargeStatus: 'PENDING',
          providerStatus: 'PAID',
          mismatchField: field,
          failureStage: 'charge_payment_mismatch',
        },
      }),
    );
    const issues = fixture.occ.listData('operationIssues/');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ status: 'OPEN', chargeId: CHARGE_ID });
  });

  it('스테이징에서는 TEST 채널과 필드가 없는 stub 결제를 확정한다', async () => {
    const testChannel = makeService({ ...livePayment, channel: { type: 'TEST' } }, stagingConfig);
    await expect(
      testChannel.service.handleWebhook('Transaction.Paid', PAYMENT_ID),
    ).resolves.toMatchObject({ ok: true, status: 'PAID' });

    const stub = makeService({}, stagingConfig);
    await expect(stub.service.handleWebhook('Transaction.Paid', PAYMENT_ID)).resolves.toMatchObject(
      { ok: true, status: 'PAID' },
    );
  });

  it('스테이징에서도 다른 상점 결제는 확정하지 않는다', async () => {
    const fixture = makeService({ ...livePayment, storeId: 'store-other' }, stagingConfig);

    await expect(fixture.service.handleWebhook('Transaction.Paid', PAYMENT_ID)).rejects.toThrow(
      '재배송비 결제 정보가 일치하지 않습니다.',
    );
    expect(fixture.occ.getData(CHARGE_PATH)?.['status']).toBe('PENDING');
  });

  it('PORTONE_STORE_ID가 비어 있으면 상점 비교만 건너뛴다', async () => {
    const fixture = makeService(
      { ...livePayment, storeId: 'store-other' },
      { RAILWAY_ENVIRONMENT_NAME: 'production' },
    );

    await expect(
      fixture.service.handleWebhook('Transaction.Paid', PAYMENT_ID),
    ).resolves.toMatchObject({ ok: true, status: 'PAID' });
  });
});

describe('재배송비 Paid 웹훅 불일치 운영 기록', () => {
  it('금액 불일치 재전송은 같은 기록 하나로 합치고 청구는 PAID가 되지 않는다', async () => {
    const fixture = makeService({ amount: { total: FEE - 1000 } });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        fixture.service.handleWebhook('Transaction.Paid', PAYMENT_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    expect(fixture.occ.getData(CHARGE_PATH)?.['status']).toBe('PENDING');
    expect(fixture.createOrMergeIssue).toHaveBeenCalledTimes(2);
    const keys = fixture.createOrMergeIssue.mock.calls.map(([input]) => input.idempotencyKey);
    expect(new Set(keys)).toEqual(new Set([`charge-payment-mismatch:${CHARGE_ID}:${PAYMENT_ID}`]));
    expect(fixture.occ.listData('operationIssues/')).toHaveLength(1);
    expect(fixture.occ.listData('operationIssues/')[0]).toMatchObject({
      latestSnapshot: expect.objectContaining({ mismatchField: 'amount' }),
    });
  });

  it('주문과 청구의 매장이 다르면 확정하지 않고 기록한다', async () => {
    const fixture = makeService({});
    fixture.occ.updateOutsideTransaction(`orders/${ORDER_ID}`, { storeId: 'store-2' });

    await expect(
      fixture.service.handleWebhook('Transaction.Paid', PAYMENT_ID),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fixture.occ.getData(CHARGE_PATH)?.['status']).toBe('PENDING');
    expect(fixture.createOrMergeIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 'store-1',
        latestSnapshot: expect.objectContaining({ mismatchField: 'order.storeId' }),
      }),
    );
  });

  it('PortOne 상태가 PAID가 아니면 승인된 돈이 없으므로 기록하지 않는다', async () => {
    const fixture = makeService({ status: 'READY' });

    await expect(
      fixture.service.handleWebhook('Transaction.Paid', PAYMENT_ID),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fixture.occ.getData(CHARGE_PATH)?.['status']).toBe('PENDING');
    expect(fixture.createOrMergeIssue).not.toHaveBeenCalled();
  });

  it('운영 기록 저장이 실패하면 400이 아닌 오류로 끝나 PortOne이 다시 보낸다', async () => {
    const fixture = makeService({ amount: { total: 1 } });
    fixture.createOrMergeIssue.mockRejectedValueOnce(new Error('저장 실패'));

    await expect(fixture.service.handleWebhook('Transaction.Paid', PAYMENT_ID)).rejects.toThrow(
      '저장 실패',
    );
    expect(fixture.occ.getData(CHARGE_PATH)?.['status']).toBe('PENDING');
  });

  it('운영 기록 writer가 없는 직접 생성에서도 기존처럼 400으로 끝난다', async () => {
    const fixture = makeService({ amount: { total: 1 } }, undefined, { withIssueWriter: false });

    await expect(
      fixture.service.handleWebhook('Transaction.Paid', PAYMENT_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fixture.occ.listData('operationIssues/')).toHaveLength(0);
  });
});
