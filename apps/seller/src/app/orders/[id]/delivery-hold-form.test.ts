import { describe, expect, it } from 'vitest';
import {
  buildDeliveryHoldPayload,
  type DeliveryHoldFormValues,
  deliveryHoldResponsibilityFeeHint,
  HOLD_FEE_NOT_ALLOWED_HINT,
  HOLD_FEE_RANGE_HINT,
  HOLD_FEE_REQUIRED_HINT,
  HOLD_REASON_LABEL,
  isRedeliveryFeeWithinLimit,
  MAX_REDELIVERY_FEE_KRW,
  parseRedeliveryFee,
} from './delivery-hold-form';

const base: DeliveryHoldFormValues = {
  reasonCode: 'ACCESS_UNAVAILABLE',
  reasonMessage: '공동현관 비밀번호 없음',
  customerResponsible: false,
  redeliveryFee: '',
  nextContactAt: '',
  nextDeliveryAt: '',
};

describe('재배송비·책임 규칙(기사 앱·서버와 같음)', () => {
  it('0원 이하·숫자 아님은 재배송비 없음', () => {
    expect(parseRedeliveryFee('3000')).toBe(3000);
    expect(parseRedeliveryFee(0)).toBeNull();
    expect(parseRedeliveryFee('')).toBeNull();
    expect(parseRedeliveryFee('abc')).toBeNull();
  });

  it('기상 외 보류는 고객 책임 ⇔ 재배송비', () => {
    expect(
      deliveryHoldResponsibilityFeeHint({ ...base, customerResponsible: true, redeliveryFee: '' }),
    ).toBe(HOLD_FEE_REQUIRED_HINT);
    expect(
      deliveryHoldResponsibilityFeeHint({
        ...base,
        customerResponsible: false,
        redeliveryFee: 3000,
      }),
    ).toBe(HOLD_FEE_NOT_ALLOWED_HINT);
    expect(
      deliveryHoldResponsibilityFeeHint({
        ...base,
        customerResponsible: true,
        redeliveryFee: 3000,
      }),
    ).toBeNull();
    expect(deliveryHoldResponsibilityFeeHint(base)).toBeNull();
  });

  it('재배송비는 서버 상한(50,000원) 이하의 정수만 받는다', () => {
    expect(MAX_REDELIVERY_FEE_KRW).toBe(50_000);
    expect(HOLD_FEE_RANGE_HINT).toBe('재배송비는 50,000원 이하의 정수로 입력해 주세요.');
    expect(isRedeliveryFeeWithinLimit(null)).toBe(true);
    expect(isRedeliveryFeeWithinLimit(MAX_REDELIVERY_FEE_KRW)).toBe(true);
    expect(isRedeliveryFeeWithinLimit(MAX_REDELIVERY_FEE_KRW + 1)).toBe(false);
    expect(isRedeliveryFeeWithinLimit(1500.5)).toBe(false);
    for (const redeliveryFee of [1, '3000', MAX_REDELIVERY_FEE_KRW, '50000']) {
      expect(
        deliveryHoldResponsibilityFeeHint({ ...base, customerResponsible: true, redeliveryFee }),
      ).toBeNull();
    }
    for (const redeliveryFee of [MAX_REDELIVERY_FEE_KRW + 1, '50001', 1500.5, '3000.5', '1e21']) {
      expect(
        deliveryHoldResponsibilityFeeHint({ ...base, customerResponsible: true, redeliveryFee }),
      ).toBe(HOLD_FEE_RANGE_HINT);
    }
  });

  it('기상 보류는 책임·재배송비를 보지 않는다', () => {
    expect(
      deliveryHoldResponsibilityFeeHint({
        reasonCode: 'WEATHER',
        customerResponsible: true,
        redeliveryFee: '',
      }),
    ).toBeNull();
  });

  it('보류 유형은 서버가 받는 다섯 가지다', () => {
    expect(Object.keys(HOLD_REASON_LABEL)).toEqual([
      'WEATHER',
      'ACCESS_UNAVAILABLE',
      'ADDRESS_ISSUE',
      'CUSTOMER_UNREACHABLE',
      'OTHER',
    ]);
  });
});

describe('buildDeliveryHoldPayload', () => {
  it('기상 보류는 고객 책임 false·재배송비 null로 보내고 새 배송 시각이 필요하다', () => {
    expect(
      buildDeliveryHoldPayload({
        ...base,
        reasonCode: 'WEATHER',
        customerResponsible: true,
        redeliveryFee: 3000,
      }),
    ).toEqual({ ok: false, error: '기상 보류는 새 배송 예정 시각을 입력해 주세요.' });

    const result = buildDeliveryHoldPayload({
      ...base,
      reasonCode: 'WEATHER',
      reasonMessage: '  폭설  ',
      customerResponsible: true,
      redeliveryFee: 3000,
      nextDeliveryAt: '2026-11-11T07:00',
    });
    expect(result).toEqual({
      ok: true,
      payload: {
        reasonCode: 'WEATHER',
        reasonMessage: '폭설',
        customerResponsible: false,
        redeliveryFee: null,
        nextContactAt: null,
        nextDeliveryAt: new Date('2026-11-11T07:00').toISOString(),
      },
    });
  });

  it('고객 책임 유료 보류는 재배송비와 함께 보낸다', () => {
    expect(
      buildDeliveryHoldPayload({
        ...base,
        reasonCode: 'CUSTOMER_UNREACHABLE',
        customerResponsible: true,
        redeliveryFee: '5000',
        nextContactAt: '2026-11-10T10:00',
      }),
    ).toEqual({
      ok: true,
      payload: {
        reasonCode: 'CUSTOMER_UNREACHABLE',
        reasonMessage: '공동현관 비밀번호 없음',
        customerResponsible: true,
        redeliveryFee: 5000,
        nextContactAt: new Date('2026-11-10T10:00').toISOString(),
        nextDeliveryAt: null,
      },
    });
  });

  it('사유가 비었거나 책임·재배송비가 어긋나면 보내지 않고 고칠 방법을 준다', () => {
    expect(buildDeliveryHoldPayload({ ...base, reasonMessage: '   ' })).toEqual({
      ok: false,
      error: '보류 사유를 입력해 주세요.',
    });
    expect(buildDeliveryHoldPayload({ ...base, customerResponsible: true })).toEqual({
      ok: false,
      error: HOLD_FEE_REQUIRED_HINT,
    });
    expect(buildDeliveryHoldPayload({ ...base, redeliveryFee: 3000 })).toEqual({
      ok: false,
      error: HOLD_FEE_NOT_ALLOWED_HINT,
    });
  });

  it('상한을 넘거나 정수가 아닌 재배송비는 보내지 않고 고칠 방법을 준다', () => {
    for (const redeliveryFee of ['60000', 1500.5]) {
      expect(
        buildDeliveryHoldPayload({
          ...base,
          reasonCode: 'CUSTOMER_UNREACHABLE',
          customerResponsible: true,
          redeliveryFee,
        }),
      ).toEqual({ ok: false, error: HOLD_FEE_RANGE_HINT });
    }
    expect(
      buildDeliveryHoldPayload({
        ...base,
        reasonCode: 'CUSTOMER_UNREACHABLE',
        customerResponsible: true,
        redeliveryFee: MAX_REDELIVERY_FEE_KRW,
      }),
    ).toMatchObject({ ok: true, payload: { redeliveryFee: MAX_REDELIVERY_FEE_KRW } });
  });

  it('읽을 수 없는 날짜는 보내지 않는다', () => {
    expect(buildDeliveryHoldPayload({ ...base, nextContactAt: 'not-a-date' })).toEqual({
      ok: false,
      error: '날짜와 시각을 다시 확인해 주세요.',
    });
  });
});
