'use client';

import { Button } from '@greenhub/ui/components/button';

interface Props {
  totalAmount: number;
  isGroup: boolean;
  isUnavailable: boolean;
  unavailableLabel?: string;
  canBuy: boolean;
  canAddToCart?: boolean;
  addToCartLabel?: string;
  buyNowLabel?: string;
  onAddToCart: () => void;
  onBuyNow: () => void;
}

export default function ProductCTABar({
  totalAmount,
  isGroup,
  isUnavailable,
  unavailableLabel,
  canBuy,
  canAddToCart = !(isGroup && isUnavailable),
  addToCartLabel = '장바구니',
  buyNowLabel,
  onAddToCart,
  onBuyNow,
}: Props) {
  const ctaLabel =
    buyNowLabel ??
    (isUnavailable
      ? (unavailableLabel ?? '판매 준비 중')
      : isGroup
        ? '공구 참여하기'
        : '바로 결제');

  // ① 외형 유지(UI 교체 P5): Mantine Box·Group(justify space-between·mb 8, gap 8 nowrap)·
  // Text(style 15px·줄 높이 1.55)·Button(lg 50px·radius xl, flex 1·2)과 같은 계산값.
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        backgroundColor: 'var(--color-bg)',
        borderTop: 'var(--border)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div
        style={{
          maxWidth: 430,
          margin: '0 auto',
          padding: '10px 16px 12px',
        }}
      >
        {/* 총 금액 */}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
          <p
            className="m-0 p-0 leading-[1.55] font-normal"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            총 금액
          </p>
          <p
            className="m-0 p-0 leading-[1.55]"
            style={{
              fontWeight: 'var(--fw-extrabold)',
              fontSize: 'var(--font-size-lg)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--color-text)',
            }}
          >
            {totalAmount.toLocaleString()}원
          </p>
        </div>

        {/* 버튼: 디자인 기준 §4 — 완전히 둥근 버튼, 보조는 외곽선 */}
        <div className="flex flex-nowrap items-center justify-start gap-2">
          <Button
            className="flex-1"
            variant="outline"
            size="lg"
            disabled={!canAddToCart}
            onClick={onAddToCart}
          >
            {addToCartLabel}
          </Button>
          <Button
            className="flex-[2]"
            size="lg"
            disabled={!canBuy}
            onClick={onBuyNow}
            style={{
              backgroundColor: isUnavailable
                ? 'var(--color-text-disabled)'
                : 'var(--color-primary)',
              color: 'var(--color-bg)',
            }}
          >
            {ctaLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
