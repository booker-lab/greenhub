import type { CustomerFaultClosureEligibility } from '@greenhub/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CustomerFaultClosurePanel,
  CustomerFaultClosureRecordView,
  CustomerFaultClosureSection,
} from './CustomerFaultClosureSection';

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));
vi.mock('@/lib/api', () => ({ apiJson: vi.fn() }));

const eligible: CustomerFaultClosureEligibility = {
  eligible: true,
  reason: 'OK',
  closureReasonCode: 'REDELIVERY_FEE_UNPAID',
  eligibleAt: '2026-11-16T15:00:00.000Z',
  paymentDeadlineDate: '2026-11-16',
  redeliveryFee: 5000,
};

const panel = (eligibility: CustomerFaultClosureEligibility) =>
  renderToStaticMarkup(
    <CustomerFaultClosurePanel
      eligibility={eligibility}
      submitting={false}
      error={null}
      onClearError={() => {}}
      onSubmit={async () => true}
    />,
  );

describe('CustomerFaultClosurePanel', () => {
  it('종결할 수 있으면 설명과 "환불 없이 주문 종결" 버튼을 보인다', () => {
    const html = panel(eligible);
    expect(html).toContain('환불 없이 주문 종결');
    expect(html).toContain('11월 16일까지 재배송비를 결제하지 않았어요');
  });

  it('결제 기한 안이면 버튼 대신 종결 가능 시각을 보인다', () => {
    const html = panel({ ...eligible, eligible: false, reason: 'PAYMENT_WINDOW_OPEN' });
    expect(html).toContain('11월 17일 00:00부터 종결할 수 있어요');
    expect(html).not.toContain('환불 없이 주문 종결');
  });

  it('결제가 진행 중이면 그 이유를 보인다', () => {
    const html = panel({ ...eligible, eligible: false, reason: 'REDELIVERY_PAYMENT_IN_PROGRESS' });
    expect(html).toContain('재배송비 결제가 진행 중이에요');
    expect(html).not.toContain('<button');
  });

  it('종결 대상이 아니면 아무것도 그리지 않는다', () => {
    expect(panel({ ...eligible, eligible: false, reason: 'NOT_HELD' })).toBe('');
  });
});

describe('CustomerFaultClosureRecordView', () => {
  it('종결 사유·시각과 판매자 메모를 보인다', () => {
    const html = renderToStaticMarkup(
      <CustomerFaultClosureRecordView
        record={{
          reasonCode: 'RECEIPT_REFUSED',
          heldAt: '2026-11-13T06:00:00.000Z',
          redeliveryFee: 5000,
          actorRole: 'seller',
          actorId: 'seller-1',
          memo: '11/14 통화, 받지 않겠다고 함',
          closedAt: '2026-11-14T01:30:00.000Z',
        }}
      />,
    );
    expect(html).toContain('고객 사유 종결');
    expect(html).toContain('수령 거부로 11월 14일 10:30에 환불 없이 종결한 주문이에요');
    expect(html).toContain('손님과 연락한 내용: 11/14 통화, 받지 않겠다고 함');
  });
});

describe('CustomerFaultClosureSection', () => {
  const order = {
    status: 'CLOSED_UNDELIVERED' as const,
    roundId: 'round-1',
    deliveryMethod: 'direct' as const,
    deliveryHold: null,
    customerFaultClosure: null,
  };

  it('종결한 주문은 판정을 묻지 않고 기록을 보인다', () => {
    const html = renderToStaticMarkup(
      <CustomerFaultClosureSection
        storeId="store-1"
        orderId="order-1"
        order={order}
        onClosed={() => {}}
      />,
    );
    expect(html).toContain('환불 없이 종결한 주문이에요');
    expect(html).not.toContain('환불 없이 주문 종결');
  });

  it('보류가 아닌 주문은 아무것도 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <CustomerFaultClosureSection
        storeId="store-1"
        orderId="order-1"
        order={{ ...order, status: 'DELIVERING' }}
        onClosed={() => {}}
      />,
    );
    expect(html).toBe('');
  });
});
