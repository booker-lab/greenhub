import { describe, expect, it } from 'vitest';
import {
  canSubmitCustomerFaultClosure,
  customerFaultClosureBlockedMessage,
  describeCustomerFaultClosureEligible,
  describeCustomerFaultClosureRecord,
  formatClosureTimeKST,
  parseCustomerFaultClosureEligibility,
  shouldCheckCustomerFaultClosure,
  shouldCheckCustomerFaultClosureSettlement,
} from './customer-fault-closure';

const hold = {
  heldAt: '2026-11-13T06:00:00.000Z',
  reasonCode: 'CUSTOMER_UNREACHABLE' as const,
  reasonMessage: '연락 안 됨',
  customerResponsible: true,
  redeliveryFee: 5000,
  nextContactAt: null,
  nextDeliveryAt: null,
  resolvedAt: null,
};

const base = {
  status: 'DELIVERY_HELD' as const,
  roundId: 'round-1',
  deliveryMethod: 'direct' as const,
  deliveryHold: hold,
  redeliveryPayment: undefined,
};

describe('종결 판정을 물을 주문', () => {
  it('회차 직배송의 고객 책임 보류(보류 중·결제 대기 준비)만 묻는다', () => {
    expect(shouldCheckCustomerFaultClosure(base)).toBe(true);
    expect(
      shouldCheckCustomerFaultClosure({
        ...base,
        status: 'PREPARING',
        redeliveryPayment: {
          required: true,
          holdAt: hold.heldAt,
          chargeId: null,
          status: 'MISSING',
          canPay: true,
          paid: false,
          requiresRecovery: false,
        },
      }),
    ).toBe(true);
  });

  it('고객 책임이 아니거나 해소된 보류·택배·옛 주문·다른 상태는 묻지 않는다', () => {
    expect(
      shouldCheckCustomerFaultClosure({
        ...base,
        deliveryHold: { ...hold, customerResponsible: false },
      }),
    ).toBe(false);
    expect(
      shouldCheckCustomerFaultClosure({
        ...base,
        deliveryHold: { ...hold, resolvedAt: '2026-11-14T00:00:00.000Z' },
      }),
    ).toBe(false);
    expect(shouldCheckCustomerFaultClosure({ ...base, deliveryMethod: 'parcel' })).toBe(false);
    expect(shouldCheckCustomerFaultClosure({ ...base, roundId: null })).toBe(false);
    expect(shouldCheckCustomerFaultClosure({ ...base, status: 'PREPARING' })).toBe(false);
    expect(shouldCheckCustomerFaultClosure({ ...base, status: 'CLOSED_UNDELIVERED' })).toBe(false);
  });
});

describe('판정 응답 읽기', () => {
  it('정상 응답을 그대로 읽는다', () => {
    expect(
      parseCustomerFaultClosureEligibility({
        eligible: false,
        reason: 'PAYMENT_WINDOW_OPEN',
        closureReasonCode: 'REDELIVERY_FEE_UNPAID',
        eligibleAt: '2026-11-16T15:00:00.000Z',
        paymentDeadlineDate: '2026-11-16',
        redeliveryFee: 5000,
      }),
    ).toEqual({
      eligible: false,
      reason: 'PAYMENT_WINDOW_OPEN',
      closureReasonCode: 'REDELIVERY_FEE_UNPAID',
      eligibleAt: '2026-11-16T15:00:00.000Z',
      paymentDeadlineDate: '2026-11-16',
      redeliveryFee: 5000,
    });
  });

  it('이미 종결한 주문의 정산 없음 표시를 읽는다(true일 때만 true)', () => {
    const closed = {
      eligible: false,
      reason: 'ALREADY_CLOSED',
      closureReasonCode: 'RECEIPT_REFUSED',
      eligibleAt: null,
      paymentDeadlineDate: null,
      redeliveryFee: 5000,
    };
    expect(
      parseCustomerFaultClosureEligibility({ ...closed, settlementMissing: true }),
    ).toMatchObject({ reason: 'ALREADY_CLOSED', settlementMissing: true });
    expect(
      parseCustomerFaultClosureEligibility({ ...closed, settlementMissing: 'yes' }),
    ).toMatchObject({ settlementMissing: false });
    expect(parseCustomerFaultClosureEligibility(closed)).toMatchObject({
      settlementMissing: false,
    });
  });

  it('종결 대상 판별: 종결한 주문은 정산 확인을 위해 판정을 묻는다', () => {
    expect(shouldCheckCustomerFaultClosureSettlement({ status: 'CLOSED_UNDELIVERED' })).toBe(true);
    expect(shouldCheckCustomerFaultClosureSettlement({ status: 'DELIVERED' })).toBe(false);
  });

  it('모양이 다르거나 eligible과 reason이 어긋나면 null(버튼을 숨긴다)', () => {
    for (const bad of [
      null,
      'ok',
      {},
      { eligible: 'yes', reason: 'OK' },
      { eligible: true, reason: 'UNKNOWN' },
      { eligible: true, reason: 'PAYMENT_WINDOW_OPEN' },
      { eligible: false, reason: 'OK' },
    ]) {
      expect(parseCustomerFaultClosureEligibility(bad)).toBeNull();
    }
  });
});

describe('안내 문구', () => {
  it('결제 기한 안이면 종결 가능 시각(한국 시간)을 알려 준다', () => {
    expect(
      customerFaultClosureBlockedMessage({
        reason: 'PAYMENT_WINDOW_OPEN',
        eligibleAt: '2026-11-16T15:00:00.000Z',
      }),
    ).toBe('손님이 재배송비를 결제하지 않으면 11월 17일 00:00부터 종결할 수 있어요.');
  });

  it('결제 진행 중·결제 완료·운영 확인·취소 진행은 이유를 알려 준다', () => {
    expect(
      customerFaultClosureBlockedMessage({
        reason: 'REDELIVERY_PAYMENT_IN_PROGRESS',
        eligibleAt: null,
      }),
    ).toContain('재배송비 결제가 진행 중이에요');
    expect(
      customerFaultClosureBlockedMessage({ reason: 'REDELIVERY_FEE_PAID', eligibleAt: null }),
    ).toContain('재배송을 진행해 주세요');
    expect(
      customerFaultClosureBlockedMessage({
        reason: 'REDELIVERY_PAYMENT_NEEDS_REVIEW',
        eligibleAt: null,
      }),
    ).toContain('운영팀');
    expect(
      customerFaultClosureBlockedMessage({ reason: 'CANCELLATION_IN_PROGRESS', eligibleAt: null }),
    ).toContain('취소가 진행 중');
  });

  it('종결 대상이 아닌 주문은 아무 안내도 보이지 않는다', () => {
    for (const reason of [
      'OK',
      'ALREADY_CLOSED',
      'NOT_ROUND_ORDER',
      'NOT_DIRECT_DELIVERY',
      'NOT_HELD',
      'HOLD_REASON_NOT_ELIGIBLE',
      'NOT_CUSTOMER_RESPONSIBLE',
    ] as const) {
      expect(customerFaultClosureBlockedMessage({ reason, eligibleAt: null })).toBeNull();
    }
  });

  it('종결 가능 설명은 수령 거부와 재배송비 미결제를 구분한다', () => {
    expect(
      describeCustomerFaultClosureEligible({
        closureReasonCode: 'RECEIPT_REFUSED',
        paymentDeadlineDate: '2026-11-16',
      }),
    ).toContain('수령을 거부');
    expect(
      describeCustomerFaultClosureEligible({
        closureReasonCode: 'REDELIVERY_FEE_UNPAID',
        paymentDeadlineDate: '2026-11-16',
      }),
    ).toContain('11월 16일까지 재배송비를 결제하지 않았어요');
  });

  it('종결 기록 요약에 사유와 종결 시각을 쓴다', () => {
    expect(
      describeCustomerFaultClosureRecord({
        reasonCode: 'RECEIPT_REFUSED',
        closedAt: '2026-11-14T01:30:00.000Z',
      }),
    ).toBe('수령 거부로 11월 14일 10:30에 환불 없이 종결한 주문이에요. 상품은 직접 처리해 주세요.');
    expect(describeCustomerFaultClosureRecord(null)).toBeNull();
  });

  it('한국 시간 표시는 잘못된 값이면 null이다', () => {
    expect(formatClosureTimeKST('2026-11-16T15:00:00.000Z')).toBe('11월 17일 00:00');
    expect(formatClosureTimeKST('잘못된 값')).toBeNull();
    expect(formatClosureTimeKST(null)).toBeNull();
  });
});

describe('종결 확정 조건', () => {
  it('손님과 연락한 내용이 한 줄(1~200자)이어야 한다', () => {
    expect(canSubmitCustomerFaultClosure('11/14 통화, 수령 거부')).toBe(true);
    expect(canSubmitCustomerFaultClosure('   ')).toBe(false);
    expect(canSubmitCustomerFaultClosure('첫 줄\n둘째 줄')).toBe(false);
    expect(canSubmitCustomerFaultClosure('a'.repeat(201))).toBe(false);
    expect(canSubmitCustomerFaultClosure('a'.repeat(200))).toBe(true);
  });
});
