import { describe, expect, it } from 'vitest';
import {
  isWithinSellerRefundWindow,
  POST_DELIVERY_REFUND_REASON_CODES,
  POST_DELIVERY_REFUND_REASON_LABEL,
  POST_DELIVERY_REFUND_SELLER_WINDOW_DAYS,
} from './post-delivery-refund.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-10T00:00:00.000Z');

describe('isWithinSellerRefundWindow', () => {
  it('배송 완료 3일째는 기간 안이다', () => {
    expect(isWithinSellerRefundWindow(NOW - 3 * DAY_MS, NOW)).toBe(true);
  });

  it('7일이 되기 직전은 기간 안, 정확히 7일부터는 기간 밖이다', () => {
    expect(isWithinSellerRefundWindow(NOW - 7 * DAY_MS + 1, NOW)).toBe(true);
    expect(isWithinSellerRefundWindow(NOW - 7 * DAY_MS, NOW)).toBe(false);
    expect(isWithinSellerRefundWindow(NOW - 8 * DAY_MS, NOW)).toBe(false);
  });

  it('settledAt이 없거나 미래·잘못된 값이면 기간 밖으로 본다(fail closed)', () => {
    expect(isWithinSellerRefundWindow(null, NOW)).toBe(false);
    expect(isWithinSellerRefundWindow(undefined, NOW)).toBe(false);
    expect(isWithinSellerRefundWindow(Number.NaN, NOW)).toBe(false);
    expect(isWithinSellerRefundWindow(NOW + 1, NOW)).toBe(false);
  });
});

describe('사유 정의', () => {
  it('사유 코드마다 라벨이 있고 기간은 7일이다', () => {
    for (const code of POST_DELIVERY_REFUND_REASON_CODES) {
      expect(POST_DELIVERY_REFUND_REASON_LABEL[code]).toBeTruthy();
    }
    expect(POST_DELIVERY_REFUND_SELLER_WINDOW_DAYS).toBe(7);
  });
});
