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

  // ② 하단 고정 바는 한 줄(design-direction.md §4.3): 외곽선 "장바구니"와 초록 주 버튼만 둔다. 총 금액은
  // 살 수 있을 때 주 버튼 글자 앞에 넣는다("39,000원 바로 구매"). 본문과는 위쪽 선 대신 고정 바 그림자로 나눈다(§3.1).
  const primaryLabel = canBuy && !isUnavailable ? `${totalAmount.toLocaleString()}원 ${ctaLabel}` : ctaLabel;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        backgroundColor: 'var(--color-bg)',
        boxShadow: 'var(--bar-shadow)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div
        className="flex flex-nowrap items-center justify-start gap-2"
        style={{
          maxWidth: 430,
          margin: '0 auto',
          padding: '12px 16px',
        }}
      >
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
            backgroundColor: isUnavailable ? 'var(--color-text-disabled)' : 'var(--primary)',
            color: 'var(--color-bg)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {primaryLabel}
        </Button>
      </div>
    </div>
  );
}
