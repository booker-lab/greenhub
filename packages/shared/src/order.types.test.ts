import { describe, expect, it } from 'vitest';
import { ORDER_STATUS_COLOR, ORDER_STATUS_LABEL, ORDER_STATUSES } from './order.types.js';

describe('주문 상태 표현 SSOT', () => {
  it('모든 주문 상태에 라벨과 색을 제공한다', () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_STATUS_LABEL[status]).toBeTruthy();
      expect(ORDER_STATUS_COLOR[status]).toBeTruthy();
    }
  });

  it('거점 픽업 완료 라벨은 공백을 포함한 단일 표기를 사용한다', () => {
    expect(ORDER_STATUS_LABEL.PICKED_UP).toBe('픽업 완료');
  });
});
