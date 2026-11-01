import { describe, expect, it } from 'vitest';
import { canPay, describePayConfirm } from './_lib';

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
      payoutAccount: {
        bankName: '국민은행',
        accountHolder: '김그린',
        accountNumber: '110-123-456789',
      },
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
    expect(text).toContain('입금할 계좌가 없어 지급 완료로 기록할 수 없습니다.');
    expect(text).not.toContain('지급 완료 처리하시겠습니까?');
  });
});

describe('지급 가능 여부', () => {
  const account = {
    bankName: '국민은행',
    accountHolder: '김그린',
    accountNumber: '110-123-456789',
  };

  it('확정이고 보류가 없고 계좌가 있으면 지급할 수 있다', () => {
    expect(canPay({ status: 'confirmed', holdReason: null, payoutAccount: account })).toBe(true);
  });

  it.each([
    ['계좌 미등록', { status: 'confirmed', holdReason: null, payoutAccount: null }],
    ['보류 중', { status: 'confirmed', holdReason: 'PROVIDER_REVERSAL', payoutAccount: account }],
    ['확정 전', { status: 'pending', holdReason: null, payoutAccount: account }],
  ] as const)('%s이면 지급할 수 없다', (_label, s) => {
    expect(canPay(s)).toBe(false);
  });
});
