/**
 * 배송 보류 입력의 책임·재배송비 일치 판단 (DOM 없음, node:test로 검증).
 *
 * 서버 규칙(apps/api/src/orders/delivery-hold-policy.ts)과 같다.
 * - 기상 보류는 고객 책임·재배송비를 둘 수 없다(모달이 두 칸을 잠근다).
 * - 그 밖의 보류는 고객 책임이면 0원보다 큰 재배송비가 있어야 하고, 고객 책임이 아니면
 *   재배송비를 둘 수 없다. 유료 재배송 결제는 둘이 함께일 때만 열리기 때문이다.
 * - 재배송비는 상한(MAX_REDELIVERY_FEE_KRW) 이하의 정수다(apps/api/src/orders/dto/update-status.dto.ts).
 * - 수령 거부는 고객 책임으로만 남는다(모달이 고객 책임 칸을 켠 채 잠그고 재배송비만 바꾸게 한다).
 * - 상품 파손은 배송 중에만 고를 수 있고, 기상처럼 고객 책임·재배송비를 둘 수 없다. 다시 배송하지 않으므로
 *   새 배송 예정도 비운다(판매자가 주문을 취소·환불한다).
 */

/** 기사 보류 창의 유형 순서. 상품 파손은 배송 중(DELIVERING)일 때만 보인다(driverHoldReasonOptions). */
export const DRIVER_HOLD_REASONS = [
  'WEATHER',
  'ACCESS_UNAVAILABLE',
  'ADDRESS_ISSUE',
  'CUSTOMER_UNREACHABLE',
  'RECEIPT_REFUSED',
  'PRODUCT_DAMAGED',
] as const;

export type DriverHoldReason = (typeof DRIVER_HOLD_REASONS)[number];

/** 지금 주문 상태에서 고를 수 있는 보류 유형. 상품 파손은 서버가 배송 중인 기사에게만 받는다. */
export function driverHoldReasonOptions(orderStatus: string): DriverHoldReason[] {
  return DRIVER_HOLD_REASONS.filter(
    (reasonCode) => reasonCode !== 'PRODUCT_DAMAGED' || orderStatus === 'DELIVERING',
  );
}

/** 고객 책임·재배송비를 둘 수 없는(판매자·기사 책임으로 고정된) 유형. 두 칸을 잠근다. */
export function isSellerResponsibleOnlyReason(reasonCode: string | null): boolean {
  return reasonCode === 'WEATHER' || reasonCode === 'PRODUCT_DAMAGED';
}

/** 고객 책임으로만 남기는 유형. 고객 책임 칸을 켠 채 잠그고 재배송비만 바꿀 수 있다. */
export function isCustomerResponsibleOnlyReason(reasonCode: string | null): boolean {
  return reasonCode === 'RECEIPT_REFUSED';
}

/** 다시 배송하지 않는 유형(상품 파손). 새 배송 예정 칸을 잠그고 비운다. */
export function isNonRedeliverableDriverHoldReason(reasonCode: string | null): boolean {
  return reasonCode === 'PRODUCT_DAMAGED';
}

/** 상품 파손을 고르면 저장 전에 보이는 안내. 저장하면 되돌릴 수 없다는 것과 그다음 할 일을 알린다. */
export const PRODUCT_DAMAGED_HOLD_NOTICE =
  '저장하면 이 주문은 다시 배송할 수 없어요. 상품을 가게로 돌려주세요. 판매자가 확인한 뒤 주문을 취소·환불해요.';

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

/**
 * 보류 유형을 바꾼 뒤의 고객 책임·재배송비 칸 값. 기상·상품 파손은 둘 다 비우고, 수령 거부는 고객 책임을
 * 켜고 빈 재배송비 칸을 기준 금액으로 채운다(이미 적은 금액은 둔다). 그 밖의 유형은 그대로 둔다.
 */
export function holdResponsibilityAfterReasonChange(args: {
  reasonCode: string | null;
  customerResponsible: boolean;
  redeliveryFee: string | number;
}): { customerResponsible: boolean; redeliveryFee: string | number } {
  if (isSellerResponsibleOnlyReason(args.reasonCode)) {
    return { customerResponsible: false, redeliveryFee: '' };
  }
  if (isCustomerResponsibleOnlyReason(args.reasonCode)) {
    return {
      customerResponsible: true,
      redeliveryFee: redeliveryFeeAfterResponsibilityChange({
        customerResponsible: true,
        redeliveryFee: args.redeliveryFee,
      }),
    };
  }
  return { customerResponsible: args.customerResponsible, redeliveryFee: args.redeliveryFee };
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

export const HOLD_RECEIPT_REFUSED_RESPONSIBILITY_HINT =
  '수령 거부는 고객 책임이에요. 고객 책임을 선택하고 재배송비를 입력해 주세요.';
export const HOLD_FEE_REQUIRED_HINT = '고객 책임이면 재배송비를 입력해 주세요.';
export const HOLD_FEE_NOT_ALLOWED_HINT =
  '재배송비는 고객 책임일 때만 받을 수 있어요. 고객 책임을 선택하거나 재배송비를 지워 주세요.';
export const HOLD_FEE_RANGE_HINT = `재배송비는 ${MAX_REDELIVERY_FEE_KRW.toLocaleString('ko-KR')}원 이하의 정수로 입력해 주세요.`;

/** 금액을 천 단위로 구분해 "10,000원"처럼 쓴다. */
export function formatKrw(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

/**
 * "고객 책임"을 고르면 재배송비 칸 바로 아래에 보이는 결과 안내(R-02). 저장하면 손님에게 그 금액이 청구되고
 * 결제 전까지 배송 재개가 잠기며, 기사 앱에는 보류 내용을 고치는 경로가 없다는 것을 알린다.
 * 기상·상품 파손 보류·고객 책임 아님·금액 없음·상한 밖이면 null이다(금액 없음·상한 밖은 deliveryHoldResponsibilityFeeHint가 안내한다).
 */
export function customerResponsibleFeeNotice(args: {
  reasonCode: string | null;
  customerResponsible: boolean;
  redeliveryFee: string | number;
}): string | null {
  if (isSellerResponsibleOnlyReason(args.reasonCode) || !args.customerResponsible) return null;
  const fee = parseRedeliveryFee(args.redeliveryFee);
  if (fee === null || !isRedeliveryFeeWithinLimit(fee)) return null;
  return `손님이 재배송비 ${formatKrw(fee)}을 결제해야 다시 배송할 수 있어요. 저장한 뒤에는 기사 앱에서 바꿀 수 없어요.`;
}

/** 책임·재배송비가 어긋나거나 재배송비가 상한 이하 정수가 아니면 고칠 방법을 담은 안내, 맞으면 null. */
export function deliveryHoldResponsibilityFeeHint(args: {
  reasonCode: string | null;
  customerResponsible: boolean;
  redeliveryFee: string | number;
}): string | null {
  if (isSellerResponsibleOnlyReason(args.reasonCode)) return null;
  if (isCustomerResponsibleOnlyReason(args.reasonCode) && !args.customerResponsible) {
    return HOLD_RECEIPT_REFUSED_RESPONSIBILITY_HINT;
  }
  const fee = parseRedeliveryFee(args.redeliveryFee);
  const hasFee = fee !== null;
  if (args.customerResponsible && !hasFee) return HOLD_FEE_REQUIRED_HINT;
  if (!args.customerResponsible && hasFee) return HOLD_FEE_NOT_ALLOWED_HINT;
  if (!isRedeliveryFeeWithinLimit(fee)) return HOLD_FEE_RANGE_HINT;
  return null;
}
