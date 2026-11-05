import { describe, expect, it } from 'vitest';
import { canPay, describePayConfirm } from './_lib';

describe('정산 지급 확인창 내용', () => {
  const account = {
    bankName: '국민은행',
    accountHolder: '김그린',
    accountNumber: '110-123-456789',
  };
  const base = {
    storeId: 'store-abcdef1234567890',
    orderId: 'order-0001',
    totalAmount: 100000,
    platformFee: 5000,
    platformFeeRate: 0.05,
    netAmount: 95000,
    status: 'confirmed' as const,
    holdReason: null,
  };

  it('가게·주문번호·입금 계좌(전체 번호)·예금주와 거래액 − 수수료 = 지급액을 보여 준다', () => {
    const view = describePayConfirm({
      ...base,
      storeName: '난플렉스',
      orderNumber: 'ORD-77',
      payoutAccount: account,
    });
    expect(view.title).toBe('난플렉스 정산 1건 지급 완료 기록');
    expect(view.facts).toEqual([
      { label: '가게', value: '난플렉스' },
      { label: '주문번호', value: 'ORD-77' },
      { label: '입금 계좌', value: '국민은행 110-123-456789' },
      { label: '예금주', value: '김그린' },
    ]);
    expect(view.flow).toEqual([
      { label: '거래액', value: '100,000원' },
      { label: '플랫폼 수수료', value: '−5,000원 (5%)' },
      { label: '지급액', value: '95,000원' },
    ]);
    expect(view.blocked).toBeNull();
    expect(view.checkLabel).toBe('은행 앱에서 이 계좌로 95,000원 이체를 마쳤습니다');
    expect(view.confirmLabel).toBe('95,000원 지급 완료 기록');
  });

  it('이름·주문번호·계좌가 없으면 ID와 미등록을 보이고 기록할 수 없는 이유를 쓴다', () => {
    const view = describePayConfirm({ ...base, orderNumber: null, payoutAccount: null });
    expect(view.facts).toEqual([
      { label: '가게 ID', value: 'store-abcdef1234567890' },
      { label: '주문 ID', value: 'order-0001' },
      { label: '정산 계좌', value: '미등록' },
    ]);
    expect(view.blocked).toContain('입금할 계좌가 없어 지급 완료로 기록할 수 없습니다.');
  });

  it('보류 중·지급 대기 아님이면 계좌가 있어도 기록할 수 없다(canPay와 같은 조건)', () => {
    const held = { ...base, holdReason: 'PROVIDER_REVERSAL' as const, payoutAccount: account };
    expect(describePayConfirm(held).blocked).not.toBeNull();
    expect(canPay(held)).toBe(false);
    const pending = { ...base, status: 'pending' as const, payoutAccount: account };
    expect(describePayConfirm(pending).blocked).not.toBeNull();
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
