/**
 * 판매자 배송 보류 입력 규칙 (DOM 없음, vitest로 검증).
 *
 * 기사 앱 board/_lib/delivery-hold-form.ts와 같은 규칙을 앱 간 import 없이 옮겼다.
 * 서버 규칙(apps/api/src/orders/delivery-hold-policy.ts)과 같다.
 * - 기상 보류는 고객 책임·재배송비를 둘 수 없고(재배송비는 null로 보낸다), 새 배송 예정 시각이 필요하다.
 * - 그 밖의 보류는 고객 책임이면 0원보다 큰 재배송비가 있어야 하고, 고객 책임이 아니면
 *   재배송비를 둘 수 없다. 유료 재배송 결제는 둘이 함께일 때만 열리기 때문이다.
 * - 재배송비는 상한(MAX_REDELIVERY_FEE_KRW) 이하의 정수다(apps/api/src/orders/dto/update-status.dto.ts).
 * - 수령 거부는 고객 책임(단순 변심과 같음)으로만 남기므로 고객 책임 칸을 켠 채 잠근다.
 * - 출입 불가·주소 오류·고객 연락 불가는 고객 사유라 고르면 고객 책임을 켜고 재배송비 기준 금액을 채우지만
 *   끌 수 있다(2026-11-14 사용자 결정 S-04).
 * - 상품 파손은 배송 중인 기사만 남긴다. 판매자 보류 창에는 고를 수 없고, 상세에서 사유 이름만 보인다.
 */

import type { DeliveryHoldReasonCode } from '@greenhub/shared';

export type HoldReason = DeliveryHoldReasonCode;

export const HOLD_REASON_LABEL: Record<HoldReason, string> = {
  WEATHER: '기상 악화',
  ACCESS_UNAVAILABLE: '출입 불가',
  ADDRESS_ISSUE: '주소 오류',
  CUSTOMER_UNREACHABLE: '고객 연락 불가',
  RECEIPT_REFUSED: '수령 거부',
  PRODUCT_DAMAGED: '상품 파손',
  OTHER: '기타',
};

/** 판매자 보류 창에서 고를 수 있는 유형(상품 파손은 기사 전용이라 뺀다). */
export const SELLER_HOLD_REASON_OPTIONS: HoldReason[] = (
  Object.keys(HOLD_REASON_LABEL) as HoldReason[]
).filter((reasonCode) => reasonCode !== 'PRODUCT_DAMAGED');

/** 고객 책임·재배송비를 둘 수 없는(판매자 책임으로 고정된) 유형. 두 칸을 잠근다. */
export function isSellerResponsibleOnlyReason(reasonCode: string | null): boolean {
  return reasonCode === 'WEATHER' || reasonCode === 'PRODUCT_DAMAGED';
}

/** 고객 책임으로만 남기는 유형. 고객 책임 칸을 켠 채 잠그고 재배송비만 바꿀 수 있다. */
export function isCustomerResponsibleOnlyReason(reasonCode: string | null): boolean {
  return reasonCode === 'RECEIPT_REFUSED';
}

/**
 * 고객 사유로 보는 유형(출입 불가·주소 오류·고객 연락 불가). 2026-11-14 사용자 결정(S-04): 고르면 고객 책임을
 * 켜고 재배송비 기준 금액을 채우지만, 수령 거부와 달리 잠그지 않아 끌 수 있다(끄면 재배송비를 비운다).
 */
export function isCustomerResponsibleDefaultReason(reasonCode: string | null): boolean {
  return (
    reasonCode === 'ACCESS_UNAVAILABLE' ||
    reasonCode === 'ADDRESS_ISSUE' ||
    reasonCode === 'CUSTOMER_UNREACHABLE'
  );
}

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
 * 고객 책임을 고를 때 재배송비 칸에 미리 채우는 기준 금액(원).
 * 2026-11-08 사용자 결정. 기사 앱 `apps/driver/src/app/board/_lib/delivery-hold-form.ts`와 같은 값,
 * 앱 간 import 없이 옮긴 값이다. 판매자가 바꿀 수 있고, 고정 금액으로 받는 계약이 아니다.
 */
export const DEFAULT_REDELIVERY_FEE_KRW = 10_000;

/**
 * 고객 책임 체크가 바뀐 뒤의 재배송비 칸 값.
 * 체크하면 재배송비가 없을 때(빈 칸·0원) 기준 금액으로 채우고, 이미 적은 금액은 그대로 둔다.
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
 * 보류 유형을 바꾼 뒤의 고객 책임·재배송비 칸 값. 유형을 바꾸면 그 유형의 기본값으로 돌아가 이전 유형에서
 * 켜고 끈 상태가 남지 않는다(S-04).
 * - 기상·상품 파손: 둘 다 비운다(칸이 잠긴다).
 * - 수령 거부: 고객 책임을 켜고 빈 재배송비 칸을 기준 금액으로 채운다(이미 적은 금액은 둔다, 칸이 잠긴다).
 * - 출입 불가·주소 오류·고객 연락 불가: 고객 책임을 켜고 재배송비를 기준 금액으로 다시 채운다. 이전 유형에서
 *   적은 금액도 기준 금액으로 바뀐다. 끌 수 있다.
 * - 그 밖(기타): 고객 책임을 끄고 재배송비를 비운다(필요하면 직접 켠다).
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
  if (isCustomerResponsibleDefaultReason(args.reasonCode)) {
    return { customerResponsible: true, redeliveryFee: DEFAULT_REDELIVERY_FEE_KRW };
  }
  return { customerResponsible: false, redeliveryFee: '' };
}

export const HOLD_RECEIPT_REFUSED_RESPONSIBILITY_HINT =
  '수령 거부는 고객 책임이에요. 고객 책임을 선택하고 재배송비를 입력해 주세요.';
export const HOLD_PRODUCT_DAMAGED_SELLER_ERROR =
  '상품 파손 보류는 배송 중인 기사만 남길 수 있어요.';
export const HOLD_FEE_REQUIRED_HINT = '고객 책임이면 재배송비를 입력해 주세요.';
export const HOLD_FEE_NOT_ALLOWED_HINT =
  '재배송비는 고객 책임일 때만 받을 수 있어요. 고객 책임을 선택하거나 재배송비를 지워 주세요.';
export const HOLD_FEE_RANGE_HINT = `재배송비는 ${MAX_REDELIVERY_FEE_KRW.toLocaleString('ko-KR')}원 이하의 정수로 입력해 주세요.`;

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

export const HOLD_REASON_REQUIRED_MESSAGE = '보류 유형을 골라 주세요.';

export interface DeliveryHoldFormValues {
  /** 기본 선택이 없다(null). 고르지 않으면 저장할 수 없다. */
  reasonCode: HoldReason | null;
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
  const { reasonCode } = values;
  if (!reasonCode) return { ok: false, error: HOLD_REASON_REQUIRED_MESSAGE };
  // 서버도 판매자의 상품 파손 보류를 거절한다. 창에서 고를 수 없지만 보내기 전에 한 번 더 막는다.
  if (reasonCode === 'PRODUCT_DAMAGED') {
    return { ok: false, error: HOLD_PRODUCT_DAMAGED_SELLER_ERROR };
  }
  const reasonMessage = values.reasonMessage.trim();
  if (!reasonMessage) return { ok: false, error: '보류 사유를 입력해 주세요.' };
  const isWeather = reasonCode === 'WEATHER';
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
      reasonCode,
      reasonMessage,
      customerResponsible: isWeather ? false : values.customerResponsible,
      redeliveryFee: isWeather ? null : parseRedeliveryFee(values.redeliveryFee),
      nextContactAt,
      nextDeliveryAt,
    },
  };
}
