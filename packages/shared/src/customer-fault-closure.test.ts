import { describe, expect, it } from 'vitest';
import {
  customerFaultClosureEligibleAtMs,
  customerFaultClosureReasonFor,
  formatKoreanMonthDayKST,
  isCustomerFaultClosableHoldReason,
  redeliveryFeePaymentDeadlineDateKST,
  redeliveryPaymentRequestedAtOf,
} from './customer-fault-closure.js';

describe('고객 사유 종결 날짜 계산(결제 요청 시각 기준, 서울)', () => {
  it('11월 13일 오후에 결제를 요청하면 16일까지 결제할 수 있고 17일 00:00부터 종결할 수 있다', () => {
    const requestedAt = '2026-11-13T06:00:00.000Z'; // 서울 11월 13일 15:00
    expect(redeliveryFeePaymentDeadlineDateKST(requestedAt)).toBe('2026-11-16');
    expect(customerFaultClosureEligibleAtMs(requestedAt)).toBe(
      Date.parse('2026-11-16T15:00:00.000Z'),
    );
  });

  it('UTC로는 전날인 서울 새벽 요청도 서울 날짜로 센다', () => {
    const requestedAt = '2026-11-12T15:30:00.000Z'; // 서울 11월 13일 00:30
    expect(redeliveryFeePaymentDeadlineDateKST(requestedAt)).toBe('2026-11-16');
    expect(customerFaultClosureEligibleAtMs(requestedAt)).toBe(
      Date.parse('2026-11-16T15:00:00.000Z'),
    );
  });

  it('서울 23:59 요청은 그날을 요청일로 세고, 00:00 요청은 다음 날을 요청일로 센다', () => {
    const lateRequest = '2026-11-13T14:59:59.000Z'; // 서울 11월 13일 23:59:59
    expect(redeliveryFeePaymentDeadlineDateKST(lateRequest)).toBe('2026-11-16');
    expect(customerFaultClosureEligibleAtMs(lateRequest)).toBe(
      Date.parse('2026-11-16T15:00:00.000Z'),
    );
    const midnightRequest = '2026-11-13T15:00:00.000Z'; // 서울 11월 14일 00:00
    expect(redeliveryFeePaymentDeadlineDateKST(midnightRequest)).toBe('2026-11-17');
    expect(customerFaultClosureEligibleAtMs(midnightRequest)).toBe(
      Date.parse('2026-11-17T15:00:00.000Z'),
    );
  });

  it('월말을 넘겨도 날짜가 이어진다', () => {
    const requestedAt = '2026-11-29T03:00:00.000Z'; // 서울 11월 29일
    expect(redeliveryFeePaymentDeadlineDateKST(requestedAt)).toBe('2026-12-02');
    expect(customerFaultClosureEligibleAtMs(requestedAt)).toBe(
      Date.parse('2026-12-02T15:00:00.000Z'),
    );
  });

  it('요청 시각이 없거나 잘못되면 null이다(종결할 수 없다)', () => {
    for (const value of [null, undefined, '', '   ', 'not-a-date', 123]) {
      expect(redeliveryFeePaymentDeadlineDateKST(value)).toBeNull();
      expect(customerFaultClosureEligibleAtMs(value)).toBeNull();
    }
  });
});

describe('redeliveryPaymentRequestedAtOf', () => {
  it('보류 시각이 아니라 결제 요청 시각을 기한의 기준으로 읽는다', () => {
    const hold = {
      heldAt: '2026-11-10T06:00:00.000Z',
      paymentRequestedAt: '2026-11-13T06:00:00.000Z',
    };
    const requestedAt = redeliveryPaymentRequestedAtOf(hold);
    expect(requestedAt).toBe('2026-11-13T06:00:00.000Z');
    expect(redeliveryFeePaymentDeadlineDateKST(requestedAt)).toBe('2026-11-16');
  });

  it('요청 전(칸 없음·null)이거나 읽을 수 없는 값이면 null이다', () => {
    expect(redeliveryPaymentRequestedAtOf({ heldAt: '2026-11-10T06:00:00.000Z' })).toBeNull();
    expect(redeliveryPaymentRequestedAtOf({ paymentRequestedAt: null })).toBeNull();
    expect(redeliveryPaymentRequestedAtOf({ paymentRequestedAt: 'broken' })).toBeNull();
    expect(redeliveryPaymentRequestedAtOf({ paymentRequestedAt: 1_700_000_000_000 })).toBeNull();
    expect(redeliveryPaymentRequestedAtOf(null)).toBeNull();
    expect(redeliveryPaymentRequestedAtOf(undefined)).toBeNull();
  });
});

describe('보류 사유 판정', () => {
  it('기상·상품 파손은 종결할 수 없고 나머지 사유는 검토할 수 있다', () => {
    expect(isCustomerFaultClosableHoldReason('WEATHER')).toBe(false);
    expect(isCustomerFaultClosableHoldReason('PRODUCT_DAMAGED')).toBe(false);
    expect(isCustomerFaultClosableHoldReason('')).toBe(false);
    expect(isCustomerFaultClosableHoldReason(undefined)).toBe(false);
    for (const code of [
      'RECEIPT_REFUSED',
      'CUSTOMER_UNREACHABLE',
      'ADDRESS_ISSUE',
      'ACCESS_UNAVAILABLE',
      'OTHER',
    ]) {
      expect(isCustomerFaultClosableHoldReason(code)).toBe(true);
    }
  });

  it('수령 거부만 따로 두고 나머지는 재배송비 미결제다', () => {
    expect(customerFaultClosureReasonFor('RECEIPT_REFUSED')).toBe('RECEIPT_REFUSED');
    expect(customerFaultClosureReasonFor('CUSTOMER_UNREACHABLE')).toBe('REDELIVERY_FEE_UNPAID');
    expect(customerFaultClosureReasonFor('OTHER')).toBe('REDELIVERY_FEE_UNPAID');
  });
});

describe('formatKoreanMonthDayKST', () => {
  it('날짜 문자열과 시각(ms)을 서울 날짜로 쓴다', () => {
    expect(formatKoreanMonthDayKST('2026-11-16')).toBe('11월 16일');
    expect(formatKoreanMonthDayKST(Date.parse('2026-11-16T15:00:00.000Z'))).toBe('11월 17일');
    expect(formatKoreanMonthDayKST('2026-01-05')).toBe('1월 5일');
  });

  it('잘못된 값은 null이다', () => {
    expect(formatKoreanMonthDayKST(null)).toBeNull();
    expect(formatKoreanMonthDayKST('11/16')).toBeNull();
    expect(formatKoreanMonthDayKST(Number.NaN)).toBeNull();
  });
});
