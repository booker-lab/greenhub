/**
 * 판매자 배송 보류 입력 규칙 (DOM 없음, vitest로 검증).
 *
 * 기사 앱 board/_lib/delivery-hold-form.ts와 같은 규칙을 앱 간 import 없이 옮겼다.
 * 서버 규칙(apps/api/src/orders/delivery-hold-policy.ts)과 같다.
 * - 기상 보류는 고객 책임·재배송비를 둘 수 없고(재배송비는 null로 보낸다), 새 배송 예정 시각이 필요하다.
 * - 그 밖의 보류는 고객 책임이면 0원보다 큰 재배송비가 있어야 하고, 고객 책임이 아니면
 *   재배송비를 둘 수 없다. 유료 재배송 결제는 둘이 함께일 때만 열리기 때문이다.
 */

export type HoldReason =
  | 'WEATHER'
  | 'ACCESS_UNAVAILABLE'
  | 'ADDRESS_ISSUE'
  | 'CUSTOMER_UNREACHABLE'
  | 'OTHER';

export const HOLD_REASON_LABEL: Record<HoldReason, string> = {
  WEATHER: '기상 악화',
  ACCESS_UNAVAILABLE: '출입 불가',
  ADDRESS_ISSUE: '주소 오류',
  CUSTOMER_UNREACHABLE: '고객 연락 불가',
  OTHER: '기타',
};

/** 입력칸 값(숫자 또는 문자열)을 재배송비로 읽는다. 0원 이하·숫자 아님은 재배송비 없음(null)이다. */
export function parseRedeliveryFee(value: string | number): number | null {
  const fee = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(fee) && fee > 0 ? fee : null;
}

export const HOLD_FEE_REQUIRED_HINT = '고객 책임이면 재배송비를 입력해 주세요.';
export const HOLD_FEE_NOT_ALLOWED_HINT =
  '재배송비는 고객 책임일 때만 받을 수 있습니다. 고객 책임을 선택하거나 재배송비를 지워 주세요.';

/** 책임·재배송비가 어긋나면 고칠 방법을 담은 안내, 맞으면 null. */
export function deliveryHoldResponsibilityFeeHint(args: {
  reasonCode: string;
  customerResponsible: boolean;
  redeliveryFee: string | number;
}): string | null {
  if (args.reasonCode === 'WEATHER') return null;
  const hasFee = parseRedeliveryFee(args.redeliveryFee) !== null;
  if (args.customerResponsible && !hasFee) return HOLD_FEE_REQUIRED_HINT;
  if (!args.customerResponsible && hasFee) return HOLD_FEE_NOT_ALLOWED_HINT;
  return null;
}

export interface DeliveryHoldFormValues {
  reasonCode: HoldReason;
  reasonMessage: string;
  customerResponsible: boolean;
  redeliveryFee: string | number;
  /** datetime-local 입력값(현지 시각). 비우면 없음. */
  nextContactAt: string;
  nextDeliveryAt: string;
}

/** `PATCH /stores/:storeId/orders/:orderId/delivery-hold`의 deliveryHold 본문. */
export interface DeliveryHoldPayload {
  reasonCode: HoldReason;
  reasonMessage: string;
  customerResponsible: boolean;
  redeliveryFee: number | null;
  nextContactAt: string | null;
  nextDeliveryAt: string | null;
}

function toIsoOrNull(local: string): string | null | undefined {
  if (!local) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** 입력값을 서버 규칙대로 검사해 보낼 본문을 만든다. 어긋나면 고칠 방법을 담은 오류. */
export function buildDeliveryHoldPayload(
  values: DeliveryHoldFormValues,
): { ok: true; payload: DeliveryHoldPayload } | { ok: false; error: string } {
  const reasonMessage = values.reasonMessage.trim();
  if (!reasonMessage) return { ok: false, error: '보류 사유를 입력해 주세요.' };
  const isWeather = values.reasonCode === 'WEATHER';
  if (isWeather && !values.nextDeliveryAt) {
    return { ok: false, error: '기상 보류는 새 배송 예정 시각을 입력해 주세요.' };
  }
  const hint = deliveryHoldResponsibilityFeeHint(values);
  if (hint) return { ok: false, error: hint };
  const nextContactAt = toIsoOrNull(values.nextContactAt);
  const nextDeliveryAt = toIsoOrNull(values.nextDeliveryAt);
  if (nextContactAt === undefined || nextDeliveryAt === undefined) {
    return { ok: false, error: '날짜와 시각을 다시 확인해 주세요.' };
  }
  return {
    ok: true,
    payload: {
      reasonCode: values.reasonCode,
      reasonMessage,
      customerResponsible: isWeather ? false : values.customerResponsible,
      redeliveryFee: isWeather ? null : parseRedeliveryFee(values.redeliveryFee),
      nextContactAt,
      nextDeliveryAt,
    },
  };
}
