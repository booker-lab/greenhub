import { BadRequestException } from '@nestjs/common';
import { assertDeliveryHoldPolicy } from './delivery-hold-policy';

const NON_WEATHER_REASONS = [
  'ACCESS_UNAVAILABLE',
  'ADDRESS_ISSUE',
  'CUSTOMER_UNREACHABLE',
  'OTHER',
] as const;

function hold(overrides: Record<string, unknown>) {
  return { reasonMessage: '공동현관 출입 불가', ...overrides };
}

function rejectionOf(input: Record<string, unknown>): unknown {
  try {
    assertDeliveryHoldPolicy(input);
  } catch (error) {
    return error;
  }
  return null;
}

describe('assertDeliveryHoldPolicy 기상 외 보류의 책임·재배송비 일치', () => {
  it.each(
    NON_WEATHER_REASONS,
  )('%s: 고객 책임이면 0원보다 큰 재배송비가 있어야 한다', (reasonCode) => {
    for (const redeliveryFee of [null, undefined, 0, -1000, Number.NaN]) {
      const error = rejectionOf(hold({ reasonCode, customerResponsible: true, redeliveryFee }));
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe(
        '고객 책임 보류에는 0원보다 큰 재배송비가 필요합니다.',
      );
    }
  });

  it.each(NON_WEATHER_REASONS)('%s: 고객 책임이 아니면 재배송비를 받을 수 없다', (reasonCode) => {
    for (const customerResponsible of [false, undefined]) {
      const error = rejectionOf(hold({ reasonCode, customerResponsible, redeliveryFee: 3000 }));
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe(
        '고객 책임이 아닌 보류에는 재배송비를 받을 수 없습니다.',
      );
    }
  });

  it.each(NON_WEATHER_REASONS)('%s: 책임과 재배송비가 맞으면 통과한다', (reasonCode) => {
    expect(() =>
      assertDeliveryHoldPolicy(
        hold({ reasonCode, customerResponsible: true, redeliveryFee: 3000 }),
      ),
    ).not.toThrow();
    for (const redeliveryFee of [null, undefined, 0]) {
      expect(() =>
        assertDeliveryHoldPolicy(hold({ reasonCode, customerResponsible: false, redeliveryFee })),
      ).not.toThrow();
    }
    // 책임·재배송비를 아예 보내지 않으면 서버가 판매자 책임·재배송비 없음으로 저장한다.
    expect(() => assertDeliveryHoldPolicy(hold({ reasonCode }))).not.toThrow();
  });

  it('기상 보류 규칙은 그대로다', () => {
    const weather = {
      reasonCode: 'WEATHER',
      reasonMessage: '폭우로 배송 연기',
      customerResponsible: false,
      redeliveryFee: null,
      nextDeliveryAt: '2026-11-10T22:00:00.000+09:00',
    };
    expect(() => assertDeliveryHoldPolicy(weather)).not.toThrow();
    expect(rejectionOf({ ...weather, customerResponsible: true })).toBeInstanceOf(
      BadRequestException,
    );
    expect(rejectionOf({ ...weather, redeliveryFee: 3000 })).toBeInstanceOf(BadRequestException);
    expect(rejectionOf({ ...weather, nextDeliveryAt: null })).toBeInstanceOf(BadRequestException);
  });
});
