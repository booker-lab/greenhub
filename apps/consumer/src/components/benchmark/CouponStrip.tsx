'use client';

import type { CouponSpec } from '@greenhub/shared';
import { useState } from 'react';
import { useCoupons } from '@/hooks/useBenchmark';

// 홈 맨 위 "쿠폰 받기" 띠(coupons). 받을 수 있는 쿠폰이 있을 때만 보인다.
export function couponLabel(coupon: CouponSpec): string {
  const amount =
    coupon.discountType === 'amount'
      ? `${coupon.value.toLocaleString()}원`
      : `${coupon.value}%${coupon.maxDiscount ? `(최대 ${coupon.maxDiscount.toLocaleString()}원)` : ''}`;
  const min = coupon.minOrderAmount > 0 ? ` · ${coupon.minOrderAmount.toLocaleString()}원 이상` : '';
  return `${amount} 할인${min}`;
}

export default function CouponStrip({ storeId }: { storeId: string | null }) {
  const { unclaimed, claim } = useCoupons(storeId, true);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (unclaimed.length === 0 && !message) return null;

  const best = unclaimed.reduce<number>(
    (max, coupon) => Math.max(max, coupon.discountType === 'amount' ? coupon.value : (coupon.maxDiscount ?? 0)),
    0,
  );

  return (
    <div style={{ background: 'var(--color-primary-surface)', borderBottom: 'var(--border)' }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          alignItems: 'center',
          background: 'transparent',
          border: 0,
          color: 'var(--color-primary-dark)',
          cursor: 'pointer',
          display: 'flex',
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--fw-extrabold)',
          justifyContent: 'space-between',
          minHeight: 'var(--touch-target)',
          padding: '0 16px',
          width: '100%',
        }}
      >
        <span>{best > 0 ? `최대 ${best.toLocaleString()}원 할인 쿠폰` : '받을 수 있는 쿠폰'}</span>
        <span>{open ? '닫기' : `쿠폰 받기 ${unclaimed.length}`}</span>
      </button>
      {open && (
        <ul style={{ listStyle: 'none', margin: 0, padding: '0 16px 12px' }}>
          {unclaimed.map((coupon) => (
            <li
              key={coupon.id}
              style={{
                alignItems: 'center',
                background: 'var(--color-bg)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                gap: 8,
                justifyContent: 'space-between',
                marginTop: 8,
                padding: '10px 12px',
              }}
            >
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', fontSize: 'var(--font-size-sm)' }}>{coupon.name}</strong>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                  {couponLabel(coupon)}
                </span>
              </span>
              <button
                type="button"
                onClick={async () => {
                  const result = await claim(coupon.id);
                  if (result === 'ok') setMessage('쿠폰을 받았어요. 장바구니에서 자동으로 적용돼요.');
                  else if (result !== 'login') setMessage(result);
                }}
                style={{
                  background: 'var(--color-primary)',
                  border: 0,
                  borderRadius: 'var(--radius-full)',
                  color: 'var(--color-bg)',
                  cursor: 'pointer',
                  flexShrink: 0,
                  fontSize: 'var(--font-size-md)',
                  fontWeight: 'var(--fw-extrabold)',
                  minHeight: 'var(--touch-target)',
                  padding: '0 14px',
                }}
              >
                받기
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p role="status" style={{ color: 'var(--color-primary-dark)', fontSize: 'var(--font-size-sm)', margin: 0, padding: '0 16px 10px' }}>
          {message}
        </p>
      )}
    </div>
  );
}
