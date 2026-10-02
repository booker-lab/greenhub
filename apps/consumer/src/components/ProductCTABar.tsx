'use client';

import { Box, Button, Group, Text } from '@mantine/core';

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

  return (
    <Box
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
      <Box
        style={{
          maxWidth: 430,
          margin: '0 auto',
          padding: '10px 16px 12px',
        }}
      >
        {/* 총 금액 */}
        <Group justify="space-between" mb={8}>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            총 금액
          </Text>
          <Text
            style={{
              fontWeight: 'var(--fw-extrabold)',
              fontSize: 'var(--font-size-lg)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--color-text)',
            }}
          >
            {totalAmount.toLocaleString()}원
          </Text>
        </Group>

        {/* 버튼: 디자인 기준 §4 — 완전히 둥근 버튼, 보조는 외곽선 */}
        <Group gap={8} style={{ flexWrap: 'nowrap' }}>
          <Button
            flex={1}
            variant="outline"
            radius="xl"
            size="lg"
            disabled={!canAddToCart}
            onClick={onAddToCart}
          >
            {addToCartLabel}
          </Button>
          <Button
            flex={2}
            size="lg"
            radius="xl"
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
        </Group>
      </Box>
    </Box>
  );
}
