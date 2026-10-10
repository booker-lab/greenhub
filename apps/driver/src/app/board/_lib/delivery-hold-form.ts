/**
 * 배송 보류 입력의 책임·재배송비 일치 판단 (DOM 없음, node:test로 검증).
 *
 * 서버 규칙(apps/api/src/orders/delivery-hold-policy.ts)과 같다.
 * - 기상 보류는 고객 책임·재배송비를 둘 수 없다(모달이 두 칸을 잠근다).
 * - 그 밖의 보류는 고객 책임이면 0원보다 큰 재배송비가 있어야 하고, 고객 책임이 아니면
 *   재배송비를 둘 수 없다. 유료 재배송 결제는 둘이 함께일 때만 열리기 때문이다.
 */

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
