import { describe, expect, it } from 'vitest';
import { describePayConfirm } from './_lib';

describe('정산 지급 확인창 문구', () => {
  const base = {
    storeId: 'store-abcdef1234567890',
    orderId: 'order-0001',
    netAmount: 95000,
  };

  it('가게 이름·주문번호·지급액·입금 계좌를 보여 준다', () => {
    const lines = describePayConfirm({
      ...base,
      storeName: '난플렉스',
      orderNumber: 'ORD-77',
      payoutAccount: { bankName: '국민은행', accountHolder: '김그린', accountNumber: '110-123-456789' },
    }).split('\n');
    expect(lines).toContain('가게: 난플렉스');
    expect(lines).toContain('주문번호: ORD-77');
    expect(lines).toContain('지급액: ₩95,000');
    expect(lines).toContain('입금 계좌: 국민은행 110-123-456789 (예금주 김그린)');
  });

  it('이름·주문번호·계좌가 없으면 ID와 미등록 안내를 보여 준다', () => {
    const text = describePayConfirm({ ...base, orderNumber: null });
    expect(text).toContain('가게 ID: store-abcdef1234567890');
    expect(text).toContain('주문 ID: order-0001');
    expect(text).toContain('정산 계좌: 미등록');
  });
});
