import type { StoreCoupon } from '@greenhub/shared';

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

/** 쿠폰 목록 한 줄 요약. */
export function couponSummary(
  coupon: Pick<StoreCoupon, 'discountType' | 'value' | 'maxDiscount' | 'minOrderAmount'>,
) {
  const amount =
    coupon.discountType === 'amount'
      ? `${won(coupon.value)} 할인`
      : `${coupon.value}% 할인${coupon.maxDiscount ? ` (최대 ${won(coupon.maxDiscount)})` : ''}`;
  return coupon.minOrderAmount > 0 ? `${amount} · ${won(coupon.minOrderAmount)} 이상` : amount;
}
