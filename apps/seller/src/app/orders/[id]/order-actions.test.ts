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
    Object.entries(resolveOrderDetailActions({ status, deliveryMethod }))
      .filter(([, shown]) => shown)
      .map(([action]) => action);

  it.each([
    ['ACCEPTED', 'direct', ['prepare', 'cancel']],
    ['CONFIRMED', 'direct', ['prepare', 'cancel']],
    ['PREPARING', 'direct', ['hold', 'cancel']],
    ['PREPARING', 'hub', ['hold', 'cancel']],
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

  it('이미 결제된 유료 재배송은 결제 요청 알림톡 없이 수거 대기로 돌아간다고 알린다', () => {
    const order = {
      deliveryHold: hold(),
      redeliveryPayment: payment({ status: 'PAID', paid: true, chargeId: 'charge-1' }),
    };
    expect(resolveHoldReleaseMode(order)).toBe('ALREADY_PAID');
    expect(holdReleaseMessage(order)).toBe(
      '재배송비 3,000원은 이미 결제됐어요. 기사 화면 수거 대기로 돌아가 바로 배송을 다시 시작할 수 있어요.',
    );
    expect(holdReleaseMessage(order)).not.toContain('알림톡');
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
