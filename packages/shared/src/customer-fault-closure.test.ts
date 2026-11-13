import { describe, expect, it } from 'vitest';
import {
  customerFaultClosureEligibleAtMs,
  customerFaultClosureReasonFor,
  formatKoreanMonthDayKST,
  isCustomerFaultClosableHoldReason,
  redeliveryFeePaymentDeadlineDateKST,
} from './customer-fault-closure.js';

describe('고객 사유 종결 날짜 계산(서울 기준)', () => {
  it('11월 13일 오후 보류는 16일까지 결제할 수 있고 17일 00:00부터 종결할 수 있다', () => {
    const heldAt = '2026-11-13T06:00:00.000Z'; // 서울 11월 13일 15:00
    expect(redeliveryFeePaymentDeadlineDateKST(heldAt)).toBe('2026-11-16');
    expect(customerFaultClosureEligibleAtMs(heldAt)).toBe(Date.parse('2026-11-16T15:00:00.000Z'));
  });

  it('UTC로는 전날인 서울 새벽 보류도 서울 날짜로 센다', () => {
    const heldAt = '2026-11-12T15:30:00.000Z'; // 서울 11월 13일 00:30
    expect(redeliveryFeePaymentDeadlineDateKST(heldAt)).toBe('2026-11-16');
    expect(customerFaultClosureEligibleAtMs(heldAt)).toBe(Date.parse('2026-11-16T15:00:00.000Z'));
  });

  it('서울 23:59 보류는 그날을 보류일로 센다', () => {
    const heldAt = '2026-11-13T14:59:59.000Z'; // 서울 11월 13일 23:59:59
    expect(redeliveryFeePaymentDeadlineDateKST(heldAt)).toBe('2026-11-16');
    expect(customerFaultClosureEligibleAtMs(heldAt)).toBe(Date.parse('2026-11-16T15:00:00.000Z'));
  });

  it('월말을 넘겨도 날짜가 이어진다', () => {
    const heldAt = '2026-11-29T03:00:00.000Z'; // 서울 11월 29일
    expect(redeliveryFeePaymentDeadlineDateKST(heldAt)).toBe('2026-12-02');
    expect(customerFaultClosureEligibleAtMs(heldAt)).toBe(Date.parse('2026-12-02T15:00:00.000Z'));
  });

  it('잘못된 보류 시각이면 null이다(종결할 수 없다)', () => {
    for (const value of [null, undefined, '', '   ', 'not-a-date', 123]) {
      expect(redeliveryFeePaymentDeadlineDateKST(value)).toBeNull();
      expect(customerFaultClosureEligibleAtMs(value)).toBeNull();
    }
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
