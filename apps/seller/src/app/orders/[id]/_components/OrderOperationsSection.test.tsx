import type { Order, RedeliveryPaymentActionability } from '@greenhub/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RedeliveryPaymentPanel } from './OrderOperationsSection';

// 기사가 고객 책임 + 재배송비로 막 보류한 주문: 결제 건이 아직 없고 손님이 결제할 수 있다.
const justHeld: RedeliveryPaymentActionability = {
  required: true,
  holdAt: '2026-11-14T06:00:00.000Z',
  chargeId: null,
  status: 'MISSING',
  canPay: true,
  paid: false,
  requiresRecovery: false,
};

const held: NonNullable<Order['deliveryHold']> = {
  heldAt: '2026-11-14T06:00:00.000Z',
  reasonCode: 'CUSTOMER_UNREACHABLE',
  reasonMessage: '',
  customerResponsible: true,
  redeliveryFee: 3000,
  nextContactAt: null,
  nextDeliveryAt: null,
  resolvedAt: null,
};

const render = (payment: RedeliveryPaymentActionability | undefined) =>
  renderToStaticMarkup(<RedeliveryPaymentPanel payment={payment} />);

describe('RedeliveryPaymentPanel', () => {
  it('결제 건 없이 손님이 결제할 수 있으면 "재배송비 결제 전"과 재배송 준비 안내를 검정 점으로 보인다(S-03)', () => {
    const html = render(justHeld);
    expect(html).toContain('재배송비 결제 전');
    expect(html).toContain('&#x27;재배송 준비로 돌리기&#x27;를 누르면 손님에게 결제 요청이 가요.');
    expect(html).toContain('data-tone="default"');
    expect(html).not.toContain('운영 확인 필요');
  });

  it('재배송 준비로 돌린 뒤(PREPARING) 손님이 아직 결제창을 열지 않았으면 결제 요청을 보냈다고 알린다', () => {
    const html = renderToStaticMarkup(
      <RedeliveryPaymentPanel payment={justHeld} orderStatus="PREPARING" deliveryHold={held} />,
    );
    expect(html).toContain('결제 요청을 보냈어요');
    expect(html).toContain('손님이 결제하면 다시 배송할 수 있어요.');
    expect(html).toContain('data-tone="default"');
    expect(html).not.toContain('재배송 준비로 돌리기');
    expect(html).not.toContain('재배송비 결제 전');
  });

  it('보류 기록에 결제 요청 시각이 있으면 상태와 상관없이 결제 요청을 보냈다고 알린다', () => {
    const html = renderToStaticMarkup(
      <RedeliveryPaymentPanel
        payment={justHeld}
        orderStatus="DELIVERY_HELD"
        deliveryHold={{ ...held, paymentRequestedAt: '2026-11-14T07:00:00.000Z' }}
      />,
    );
    expect(html).toContain('결제 요청을 보냈어요');
    expect(html).not.toContain('재배송 준비로 돌리기');
  });

  it('보류 중이고 결제 요청 전이면 재배송 준비 안내를 그대로 보인다', () => {
    for (const deliveryHold of [held, { ...held, paymentRequestedAt: null }]) {
      const html = renderToStaticMarkup(
        <RedeliveryPaymentPanel
          payment={justHeld}
          orderStatus="DELIVERY_HELD"
          deliveryHold={deliveryHold}
        />,
      );
      expect(html).toContain('재배송비 결제 전');
      expect(html).not.toContain('결제 요청을 보냈어요');
    }
  });

  it('결제 건이 없어도 복구가 필요하면 운영 확인 필요(빨강)로 보인다', () => {
    const html = render({ ...justHeld, requiresRecovery: true });
    expect(html).toContain('운영 확인 필요');
    expect(html).toContain('data-tone="problem"');
    expect(html).not.toContain('재배송비 결제 전');
  });

  it('결제 건이 없고 손님이 결제할 수 없으면 운영 확인 필요(빨강)로 보인다', () => {
    const html = render({ ...justHeld, canPay: false });
    expect(html).toContain('운영 확인 필요');
    expect(html).toContain('재배송비 결제 정보를 확인해야 합니다.');
    expect(html).toContain('data-tone="problem"');
  });

  it.each(['FAILED', 'REFUNDED', 'MISMATCHED'] as const)(
    '%s 결제는 운영 확인 필요(빨강)로 보인다',
    (status) => {
      const html = render({ ...justHeld, status, chargeId: 'charge-1' });
      expect(html).toContain('운영 확인 필요');
      expect(html).toContain('data-tone="problem"');
    },
  );

  it('결제 대기와 결제 완료는 기존 문구를 유지한다', () => {
    expect(render({ ...justHeld, status: 'PENDING', chargeId: 'charge-1' })).toContain(
      '재배송비 결제 대기',
    );
    expect(
      render({ ...justHeld, status: 'PAID', chargeId: 'charge-1', paid: true, canPay: false }),
    ).toContain('재배송비 결제 완료');
  });

  it('재배송비가 필요 없으면 아무것도 그리지 않는다', () => {
    expect(render({ ...justHeld, required: false, status: 'NOT_REQUIRED' })).toBe('');
    expect(render(undefined)).toBe('');
  });
});
