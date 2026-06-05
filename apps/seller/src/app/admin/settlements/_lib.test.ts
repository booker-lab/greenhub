import { describe, expect, it } from 'vitest';
import type { AdminSettlement } from '@/hooks/useAdmin';
import { paymentTimingText } from './_lib';

function settlement(
  status: AdminSettlement['status'],
  fields: Partial<AdminSettlement> = {},
): AdminSettlement {
  return {
    id: 'settlement-1',
    storeId: 'store-1',
    orderId: 'order-1',
    totalAmount: 10_000,
    platformFee: 500,
    netAmount: 9_500,
    status,
    settledAt: '2026-05-26T02:30:00.000Z',
    paidAt: null,
    ...fields,
  };
}

describe('paymentTimingText', () => {
  it('지급 완료 시각을 KST로 표시한다', () => {
    expect(paymentTimingText(settlement('paid', { paidAt: '2026-05-26T04:00:00.000Z' }))).toBe(
      '입금 완료 2026-05-26 13:00',
    );
  });

  it('확정 시각이 있으면 지급 대기 문구와 함께 표시한다', () => {
    expect(
      paymentTimingText(settlement('confirmed', { confirmedAt: { _seconds: 1_779_940_800 } })),
    ).toBe('지급 대기 · 확정 2026-05-28 13:00');
  });

  it('확정 시각이 없는 과거 데이터는 지급 대기로 폴백한다', () => {
    expect(paymentTimingText(settlement('confirmed'))).toBe('지급 대기');
  });

  it('대기와 취소 상태에는 보조 문구를 추가하지 않는다', () => {
    expect(paymentTimingText(settlement('pending'))).toBeNull();
    expect(paymentTimingText(settlement('cancelled'))).toBeNull();
  });
});
