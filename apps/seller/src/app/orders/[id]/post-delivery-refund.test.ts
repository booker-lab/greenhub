import { describe, expect, it } from 'vitest';
import {
  canSubmitPostDeliveryRefund,
  formatRefundDeadline,
  postDeliveryRefundBlockedMessage,
  shouldCheckPostDeliveryRefund,
} from './post-delivery-refund';

describe('배송 후 환불 버튼 판단', () => {
  it('배송 완료로 표시된 주문만 환불 가능 여부를 묻는다', () => {
    expect(shouldCheckPostDeliveryRefund('DELIVERED')).toBe(true);
    expect(shouldCheckPostDeliveryRefund('PICKED_UP')).toBe(true);
    expect(shouldCheckPostDeliveryRefund('REVIEWED')).toBe(true);
    expect(shouldCheckPostDeliveryRefund('DELIVERING')).toBe(false);
    expect(shouldCheckPostDeliveryRefund('CANCELLED')).toBe(false);
  });

  it('7일이 지났거나 정산금이 지급됐으면 관리자 문의 안내를 보여 준다', () => {
    expect(postDeliveryRefundBlockedMessage('WINDOW_EXPIRED')).toContain('7일이 지나');
    expect(postDeliveryRefundBlockedMessage('SETTLEMENT_PAID')).toContain('관리자에게 문의');
    expect(postDeliveryRefundBlockedMessage('NO_SETTLEMENT')).toContain('관리자에게 문의');
    expect(postDeliveryRefundBlockedMessage('OK')).toBeNull();
    expect(postDeliveryRefundBlockedMessage('ALREADY_REFUNDED')).toBeNull();
  });

  it('마감 시각을 한국 시간으로 보여 준다', () => {
    expect(formatRefundDeadline('2026-11-08T06:00:00.000Z')).toBe('11월 8일 15:00');
    expect(formatRefundDeadline(null)).toBeNull();
    expect(formatRefundDeadline('잘못된 값')).toBeNull();
  });

  it('사유와 한 줄 메모가 있어야 환불을 확정할 수 있다', () => {
    expect(canSubmitPostDeliveryRefund('QUALITY_DAMAGED', '꽃잎 시듦')).toBe(true);
    expect(canSubmitPostDeliveryRefund(null, '꽃잎 시듦')).toBe(false);
    expect(canSubmitPostDeliveryRefund('BROKEN', '   ')).toBe(false);
    expect(canSubmitPostDeliveryRefund('BROKEN', '첫 줄\n둘째 줄')).toBe(false);
    expect(canSubmitPostDeliveryRefund('BROKEN', 'a'.repeat(201))).toBe(false);
  });
});
