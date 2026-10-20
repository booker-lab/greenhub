import { describe, expect, it } from 'vitest';
import { describePayConfirm } from './_lib';

describe('정산 지급 확인창 문구', () => {
  const base = {
    storeId: 'store-abcdef1234567890',
    orderId: 'order-0001',
    netAmount: 95000,
  };

  it('가게 ID 전체·주문번호·지급액을 보여 준다', () => {
    const lines = describePayConfirm({ ...base, orderNumber: 'ORD-77' }).split('\n');
    expect(lines).toContain('가게 ID: store-abcdef1234567890');
    expect(lines).toContain('주문번호: ORD-77');
    expect(lines).toContain('지급액: ₩95,000');
    expect(lines.at(-1)).toBe('이 정산을 지급 완료 처리하시겠습니까?');
  });

  it('주문번호가 없는 옛 정산은 주문 ID를 보여 준다', () => {
    const lines = describePayConfirm({ ...base, orderNumber: null }).split('\n');
    expect(lines).toContain('주문 ID: order-0001');
    expect(lines.some((line) => line.startsWith('주문번호'))).toBe(false);
    expect(describePayConfirm(base)).toContain('주문 ID: order-0001');
  });
});
