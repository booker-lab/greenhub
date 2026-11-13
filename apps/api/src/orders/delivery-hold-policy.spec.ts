import { BadRequestException } from '@nestjs/common';
import { assertDeliveryHoldOrigin, assertDeliveryHoldPolicy } from './delivery-hold-policy';

const NON_WEATHER_REASONS = [
  'ACCESS_UNAVAILABLE',
  'ADDRESS_ISSUE',
  'CUSTOMER_UNREACHABLE',
  'RECEIPT_REFUSED',
  'OTHER',
] as const;
// 수령 거부는 고객 책임으로만 남는다(아래 별도 묶음). 책임 없음 경로는 나머지 사유만 본다.
const OPTIONAL_RESPONSIBILITY_REASONS = NON_WEATHER_REASONS.filter(
  (reasonCode) => reasonCode !== 'RECEIPT_REFUSED',
);

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

  it.each(
    OPTIONAL_RESPONSIBILITY_REASONS,
  )('%s: 고객 책임이 아니면 재배송비를 받을 수 없다', (reasonCode) => {
    for (const customerResponsible of [false, undefined]) {
      const error = rejectionOf(hold({ reasonCode, customerResponsible, redeliveryFee: 3000 }));
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe(
        '고객 책임이 아닌 보류에는 재배송비를 받을 수 없습니다.',
      );
    }
  });

  it.each(OPTIONAL_RESPONSIBILITY_REASONS)('%s: 책임과 재배송비가 맞으면 통과한다', (reasonCode) => {
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

describe('assertDeliveryHoldPolicy 수령 거부·상품 파손', () => {
  it('수령 거부는 고객 책임·0원보다 큰 재배송비가 있어야 한다', () => {
    const refused = { reasonCode: 'RECEIPT_REFUSED', reasonMessage: '수령 거부' };
    expect(() =>
      assertDeliveryHoldPolicy({ ...refused, customerResponsible: true, redeliveryFee: 10_000 }),
    ).not.toThrow();
    for (const input of [
      { customerResponsible: false, redeliveryFee: null },
      { customerResponsible: undefined, redeliveryFee: undefined },
      { customerResponsible: false, redeliveryFee: 10_000 },
      { customerResponsible: true, redeliveryFee: null },
      { customerResponsible: true, redeliveryFee: 0 },
    ]) {
      expect(rejectionOf({ ...refused, ...input })).toBeInstanceOf(BadRequestException);
    }
  });

  it('상품 파손은 판매자 책임·재배송비 없음만 받고 새 배송 일정은 받지 않는다', () => {
    const damaged = {
      reasonCode: 'PRODUCT_DAMAGED',
      reasonMessage: '배송 중 파손',
      customerResponsible: false,
      redeliveryFee: null,
      nextDeliveryAt: null,
    };
    expect(() => assertDeliveryHoldPolicy(damaged)).not.toThrow();
    expect(() => assertDeliveryHoldPolicy({ ...damaged, redeliveryFee: undefined })).not.toThrow();
    for (const input of [
      { customerResponsible: true },
      { customerResponsible: undefined },
      { redeliveryFee: 10_000 },
      { redeliveryFee: 0 },
      { customerResponsible: true, redeliveryFee: 10_000 },
      { nextDeliveryAt: '2026-11-20T01:00:00.000Z' },
    ]) {
      expect(rejectionOf({ ...damaged, ...input })).toBeInstanceOf(BadRequestException);
    }
  });
});

describe('assertDeliveryHoldOrigin', () => {
  function originRejection(reasonCode: string, status: string, role: string) {
    try {
      assertDeliveryHoldOrigin(reasonCode, status, role);
    } catch (error) {
      return error;
    }
    return null;
  }

  it('상품 파손은 배송 중인 기사만 남길 수 있다', () => {
    expect(originRejection('PRODUCT_DAMAGED', 'DELIVERING', 'driver')).toBeNull();
    for (const [status, role] of [
      ['PREPARING', 'driver'],
      ['DELIVERING', 'seller'],
      ['PREPARING', 'seller'],
      ['DELIVERING', 'admin'],
      ['DELIVERING', 'consumer'],
    ]) {
      expect(originRejection('PRODUCT_DAMAGED', status, role)).toBeInstanceOf(BadRequestException);
    }
  });

  it('다른 사유는 상태·역할로 막지 않는다', () => {
    for (const reasonCode of ['RECEIPT_REFUSED', 'WEATHER', 'ACCESS_UNAVAILABLE', 'OTHER']) {
      expect(originRejection(reasonCode, 'PREPARING', 'seller')).toBeNull();
      expect(originRejection(reasonCode, 'DELIVERING', 'driver')).toBeNull();
    }
  });
});
