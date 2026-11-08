/**
 * 배송 보류 입력의 책임·재배송비 일치 판단 (DOM 없음, node:test로 검증).
 *
 * 서버 규칙(apps/api/src/orders/delivery-hold-policy.ts)과 같다.
 * - 기상 보류는 고객 책임·재배송비를 둘 수 없다(모달이 두 칸을 잠근다).
 * - 그 밖의 보류는 고객 책임이면 0원보다 큰 재배송비가 있어야 하고, 고객 책임이 아니면
 *   재배송비를 둘 수 없다. 유료 재배송 결제는 둘이 함께일 때만 열리기 때문이다.
 * - 재배송비는 상한(MAX_REDELIVERY_FEE_KRW) 이하의 정수다(apps/api/src/orders/dto/update-status.dto.ts).
 */

/** 입력칸 값(숫자 또는 문자열)을 재배송비로 읽는다. 0원 이하·숫자 아님은 재배송비 없음(null)이다. */
export function parseRedeliveryFee(value: string | number): number | null {
  const fee = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(fee) && fee > 0 ? fee : null;
}

/**
 * 재배송비 상한(원). API의 `MAX_REDELIVERY_FEE_KRW`(apps/api/src/orders/dto/update-status.dto.ts)와
 * 같은 값이다. 앱 간 import 없이 옮긴 값이므로 서버 상한이 바뀌면 함께 바꾼다.
 */
export const MAX_REDELIVERY_FEE_KRW = 50_000;

/** 재배송비 없음(null)이거나 상한 이하의 정수면 서버가 받는 재배송비다. */
export function isRedeliveryFeeWithinLimit(fee: number | null): boolean {
  return fee === null || (Number.isInteger(fee) && fee <= MAX_REDELIVERY_FEE_KRW);
}

/**
 * "고객 책임"을 고르면 미리 채우는 재배송비 기준 금액(원). 2026-11-08 사용자 결정, 판매자 보류 창
 * (apps/seller/src/app/orders/[id]/_components/DeliveryHoldModal.tsx)과 같은 값이다. 앱 간 import 없이
 * 옮긴 값이므로 바꿀 때 함께 바꾼다. 기사가 칸에서 바꿀 수 있고 상한(MAX_REDELIVERY_FEE_KRW) 검사는 그대로다.
 */
export const DEFAULT_REDELIVERY_FEE_KRW = 10_000;

/**
 * "고객 책임" 체크를 바꿀 때 재배송비 칸의 다음 값(D-09).
 * 체크하면 칸이 비어 있을 때(재배송비 없음으로 읽히는 값)만 기준 금액을 채우고, 이미 적은 금액은 두며,
 * 체크를 풀면 비운다(고객 책임이 아니면 재배송비를 둘 수 없다).
 */
export function redeliveryFeeAfterResponsibilityChange(args: {
  customerResponsible: boolean;
  redeliveryFee: string | number;
}): string | number {
  if (!args.customerResponsible) return '';
  return parseRedeliveryFee(args.redeliveryFee) === null
    ? DEFAULT_REDELIVERY_FEE_KRW
    : args.redeliveryFee;
}

export const HOLD_REASON_REQUIRED_MESSAGE = '보류 유형을 골라 주세요.';
export const HOLD_MESSAGE_REQUIRED_MESSAGE = '손님에게 보일 사유를 입력해 주세요.';
export const HOLD_WEATHER_DATE_REQUIRED_MESSAGE = '기상 악화는 새 배송 예정 시각을 입력해 주세요.';

/**
 * 저장 전 입력 검사(D-07). 유형은 기본 선택이 없으므로 먼저 고르게 한다.
 * 맞으면 null, 아니면 고칠 방법을 담은 안내. 책임·재배송비 어긋남은 deliveryHoldResponsibilityFeeHint가 맡는다.
 */
export function deliveryHoldSubmitError(args: {
  reasonCode: string | null;
  reasonMessage: string;
  nextDeliveryAt: string;
}): string | null {
  if (!args.reasonCode) return HOLD_REASON_REQUIRED_MESSAGE;
  if (!args.reasonMessage.trim()) return HOLD_MESSAGE_REQUIRED_MESSAGE;
  if (args.reasonCode === 'WEATHER' && !args.nextDeliveryAt) {
    return HOLD_WEATHER_DATE_REQUIRED_MESSAGE;
  }
  return null;
}

export const HOLD_FEE_REQUIRED_HINT = '고객 책임이면 재배송비를 입력해 주세요.';
export const HOLD_FEE_NOT_ALLOWED_HINT =
  '재배송비는 고객 책임일 때만 받을 수 있습니다. 고객 책임을 선택하거나 재배송비를 지워 주세요.';
export const HOLD_FEE_RANGE_HINT = `재배송비는 ${MAX_REDELIVERY_FEE_KRW.toLocaleString('ko-KR')}원 이하의 정수로 입력해 주세요.`;

/** 책임·재배송비가 어긋나거나 재배송비가 상한 이하 정수가 아니면 고칠 방법을 담은 안내, 맞으면 null. */
export function deliveryHoldResponsibilityFeeHint(args: {
  reasonCode: string | null;
  customerResponsible: boolean;
  redeliveryFee: string | number;
}): string | null {
  if (args.reasonCode === 'WEATHER') return null;
  const fee = parseRedeliveryFee(args.redeliveryFee);
  const hasFee = fee !== null;
  if (args.customerResponsible && !hasFee) return HOLD_FEE_REQUIRED_HINT;
  if (!args.customerResponsible && hasFee) return HOLD_FEE_NOT_ALLOWED_HINT;
  if (!isRedeliveryFeeWithinLimit(fee)) return HOLD_FEE_RANGE_HINT;
  return null;
}
