import { describe, expect, it } from 'vitest';
import { describeRefundRecovery, readRefundRecovery } from './useAdmin.refund';

describe('강제 환불 응답의 판매자 회수 정보', () => {
  it('회수가 필요하면 금액을 읽는다', () => {
    expect(
      readRefundRecovery({ ok: true, orderId: 'o1', recoveryRequired: true, recoveryAmount: 9500 }),
    ).toEqual({ amount: 9500 });
  });

  it('회수가 필요 없거나 필드가 없는 옛 응답은 null', () => {
    expect(readRefundRecovery({ ok: true, recoveryRequired: false, recoveryAmount: 0 })).toBeNull();
    expect(readRefundRecovery({ ok: true, orderId: 'o1' })).toBeNull();
    expect(readRefundRecovery(undefined)).toBeNull();
    expect(readRefundRecovery(null)).toBeNull();
    expect(readRefundRecovery('ok')).toBeNull();
  });

  it('회수 필요인데 금액 형식이 틀리면 0원으로 두되 회수 필요는 잃지 않는다', () => {
    expect(readRefundRecovery({ recoveryRequired: true, recoveryAmount: '9500' })).toEqual({
      amount: 0,
    });
  });

  it('알림 문구에 돌려받을 금액을 원 단위로 보인다', () => {
    expect(describeRefundRecovery({ amount: 12000 })).toContain(
      '판매자에게 12,000원을 돌려받아야 합니다',
    );
  });
});
