import type { RedeliveryPaymentActionability } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import { DRIVER_OPS_CONTACT } from '../../../lib/ops-contact';
import { getRedeliveryPaymentPresentation, isDeliveryStartAllowed } from './redelivery-payment';

function payment(overrides: Partial<RedeliveryPaymentActionability>): RedeliveryPaymentActionability {
  return {
    required: true,
    holdAt: '2026-07-22T00:00:00.000Z',
    chargeId: null,
    status: 'MISSING',
    canPay: false,
    paid: false,
    requiresRecovery: false,
    ...overrides,
  };
}

describe('getRedeliveryPaymentPresentation', () => {
  it('재배송비가 필요 없으면 표시하지 않는다', () => {
    expect(getRedeliveryPaymentPresentation(undefined)).toBeNull();
    expect(
      getRedeliveryPaymentPresentation(payment({ required: false, status: 'NOT_REQUIRED' })),
    ).toBeNull();
  });

  it('D-03: 결제 건이 없지만 손님이 결제할 수 있으면 "재배송비 결제 전"(노랑)이고 손님 결제 대기로 단정하지 않는다', () => {
    const view = getRedeliveryPaymentPresentation(
      payment({ status: 'MISSING', canPay: true, requiresRecovery: false }),
    );
    expect(view).toEqual({
      label: '재배송비 결제 전',
      description: '결제되면 다시 배송할 수 있어요.',
      color: 'yellow',
      needsOps: false,
    });
    expect(`${view?.label} ${view?.description}`).not.toMatch(/손님 결제 대기/);
  });

  it('D-03: 결제할 수 없는 MISSING은 지금처럼 확인 필요로 둔다', () => {
    expect(
      getRedeliveryPaymentPresentation(payment({ status: 'MISSING', canPay: false }))?.label,
    ).toBe('재배송비 결제 정보 확인 필요');
    // 회복이 필요한 MISSING은 canPay와 무관하게 운영 확인.
    expect(
      getRedeliveryPaymentPresentation(
        payment({ status: 'MISSING', canPay: true, requiresRecovery: true }),
      )?.label,
    ).toBe('운영 확인 필요');
  });

  it('D-18: 결제 완료는 짧게, "서버" 같은 내부 말 없이 쓴다', () => {
    const view = getRedeliveryPaymentPresentation(
      payment({ status: 'PAID', paid: true, chargeId: 'c1' }),
    );
    expect(view?.label).toBe('재배송비 결제 완료');
    expect(view?.description).toBe('결제됐어요. 배송을 다시 시작할 수 있어요.');
    expect(view?.needsOps).toBe(false);
  });

  it('D-18: 운영 확인 필요는 운영팀 번호를 싣고 상세가 전화 링크를 두게 한다', () => {
    for (const status of ['FAILED', 'REFUNDED', 'MISMATCHED'] as const) {
      const view = getRedeliveryPaymentPresentation(
        payment({ status, chargeId: 'c1', requiresRecovery: true }),
      );
      expect(view?.label).toBe('운영 확인 필요');
      expect(view?.color).toBe('red');
      expect(view?.needsOps).toBe(true);
      expect(view?.description).toContain(DRIVER_OPS_CONTACT.phone);
    }
  });

  it('어떤 문구에도 "서버"가 없다', () => {
    const states = [
      payment({ status: 'MISSING', canPay: true }),
      payment({ status: 'MISSING' }),
      payment({ status: 'PENDING', chargeId: 'c1', canPay: true }),
      payment({ status: 'PAID', paid: true, chargeId: 'c1' }),
      payment({ status: 'FAILED', chargeId: 'c1', requiresRecovery: true }),
    ];
    for (const state of states) {
      const view = getRedeliveryPaymentPresentation(state);
      expect(`${view?.label} ${view?.description}`).not.toMatch(/서버/);
    }
  });
});

describe('isDeliveryStartAllowed (D-03에서 바꾸지 않음)', () => {
  it('결제 전(MISSING + canPay)은 여전히 배송 시작을 잠근다', () => {
    expect(isDeliveryStartAllowed(payment({ status: 'MISSING', canPay: true }))).toBe(false);
  });

  it('필요 없음·결제 완료만 허용한다', () => {
    expect(isDeliveryStartAllowed(payment({ required: false, status: 'NOT_REQUIRED' }))).toBe(true);
    expect(isDeliveryStartAllowed(payment({ status: 'PAID', paid: true, chargeId: 'c1' }))).toBe(
      true,
    );
    expect(isDeliveryStartAllowed(null)).toBe(false);
  });
});
