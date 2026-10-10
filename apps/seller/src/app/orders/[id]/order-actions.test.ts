import type {
  DeliveryHoldSnapshot,
  OrderStatus,
  RedeliveryPaymentActionability,
} from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import {
  holdReleaseMessage,
  resolveHoldReleaseMode,
  resolveOrderDetailActions,
} from './order-actions';

describe('상태별 주문 상세 버튼', () => {
  const visible = (status: OrderStatus, deliveryMethod: 'direct' | 'hub' | 'parcel' = 'direct') =>
    Object.entries(resolveOrderDetailActions({ status, deliveryMethod, roundId: 'round-1' }))
      .filter(([, shown]) => shown)
      .map(([action]) => action);

  it.each([
    ['ACCEPTED', 'direct', ['prepare', 'cancel']],
    ['CONFIRMED', 'direct', ['prepare', 'cancel']],
    ['PREPARING', 'direct', ['hold', 'cancel']],
    ['PREPARING', 'hub', ['cancel']],
    ['PREPARING', 'parcel', ['shipParcel', 'cancel']],
    ['DELIVERY_HELD', 'direct', ['releaseHold', 'cancel']],
    ['PENDING', 'direct', []],
    ['RECRUITING', 'direct', []],
    ['DELIVERING', 'direct', []],
    ['DELIVERED', 'direct', []],
    ['CANCELLED', 'direct', []],
  ] as const)('%s(%s) → %j', (status, method, expected) => {
    expect(visible(status, method)).toEqual(expected);
  });

  it('판매자 보류는 회차 직배송 주문만 — 예전 주문은 재배송비 결제를 만들 수 없다', () => {
    for (const roundId of [null, undefined, '']) {
      const actions = resolveOrderDetailActions({
        status: 'PREPARING',
        deliveryMethod: 'direct',
        roundId,
      });
      expect(actions.hold).toBe(false);
      expect(actions.cancel).toBe(true);
    }
  });

  it('판매자 상세 응답처럼 schemaVersion이 없어도 회차 직배송 준비 중 주문에는 보류가 보인다', () => {
    // seller-order-read-model의 상세 필드에는 schemaVersion이 없다(#449 회귀: 버튼이 아예 안 보였다).
    const detailResponse = {
      status: 'PREPARING',
      deliveryMethod: 'direct',
      roundId: 'round-1',
    } as const;
    expect('schemaVersion' in detailResponse).toBe(false);
    expect(resolveOrderDetailActions(detailResponse).hold).toBe(true);
  });

  it('재배송비 결제를 기다리는 보류가 열린 준비 중 주문은 다시 보류하지 않는다(보류 건수 이중 집계)', () => {
    const base = {
      status: 'PREPARING' as const,
      deliveryMethod: 'direct' as const,
      roundId: 'round-1',
    };
    expect(
      resolveOrderDetailActions({ ...base, redeliveryPayment: payment({ required: true }) }).hold,
    ).toBe(false);
    expect(
      resolveOrderDetailActions({ ...base, redeliveryPayment: payment({ required: false }) }).hold,
    ).toBe(true);
    // 취소는 그대로 둔다 — 결제하지 않는 고객의 주문을 끝내는 방법이다.
    expect(
      resolveOrderDetailActions({ ...base, redeliveryPayment: payment({ required: true }) }).cancel,
    ).toBe(true);
  });
});

function hold(overrides: Partial<DeliveryHoldSnapshot> = {}): DeliveryHoldSnapshot {
  return {
    heldAt: '2026-11-10T01:00:00.000Z',
    reasonCode: 'CUSTOMER_UNREACHABLE',
    reasonMessage: '연락 안 됨',
    customerResponsible: true,
    redeliveryFee: 3000,
    nextContactAt: null,
    nextDeliveryAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

function payment(
  overrides: Partial<RedeliveryPaymentActionability>,
): RedeliveryPaymentActionability {
  return {
    required: true,
    holdAt: '2026-11-10T01:00:00.000Z',
    chargeId: null,
    status: 'MISSING',
    canPay: true,
    paid: false,
    requiresRecovery: false,
    ...overrides,
  };
}

describe('재배송 준비로 돌리기 확인 문구', () => {
  it('결제 전 유료 재배송이면 결제 요청 알림톡과 결제 후 배송 재개를 알린다', () => {
    const order = { deliveryHold: hold(), redeliveryPayment: payment({}) };
    expect(resolveHoldReleaseMode(order)).toBe('PAYMENT_REQUEST');
    expect(holdReleaseMessage(order)).toBe(
      '고객에게 재배송비 3,000원 결제 요청 알림톡이 가요. 결제가 끝나야 기사가 배송을 다시 시작할 수 있어요.',
    );
  });

  it('이미 결제된 유료 재배송은 결제 요청 알림톡이 한 번 더 간다는 사실을 알린다', () => {
    const order = {
      deliveryHold: hold(),
      redeliveryPayment: payment({ status: 'PAID', paid: true, chargeId: 'charge-1' }),
    };
    expect(resolveHoldReleaseMode(order)).toBe('ALREADY_PAID');
    expect(holdReleaseMessage(order)).toContain('재배송비 3,000원은 이미 결제됐어요');
    expect(holdReleaseMessage(order)).toContain('결제 요청 알림톡이 한 번 더 가요');
  });

  it('무료·판매자 책임 보류는 알림톡 없이 수거 대기로 돌아간다', () => {
    const order = {
      deliveryHold: hold({
        reasonCode: 'WEATHER',
        customerResponsible: false,
        redeliveryFee: null,
      }),
      redeliveryPayment: payment({ required: false, status: 'NOT_REQUIRED', canPay: false }),
    };
    expect(resolveHoldReleaseMode(order)).toBe('FREE');
    expect(holdReleaseMessage(order)).toBe('기사 화면 수거 대기로 돌아가요(알림톡 없음).');
  });

  it('결제 정보가 없으면 보류 내용(고객 책임·재배송비·미해소)으로 판단한다', () => {
    expect(resolveHoldReleaseMode({ deliveryHold: hold() })).toBe('PAYMENT_REQUEST');
    expect(
      resolveHoldReleaseMode({ deliveryHold: hold({ resolvedAt: '2026-11-10T02:00:00.000Z' }) }),
    ).toBe('FREE');
    expect(resolveHoldReleaseMode({ deliveryHold: hold({ customerResponsible: false }) })).toBe(
      'FREE',
    );
    expect(resolveHoldReleaseMode({})).toBe('FREE');
  });
});
