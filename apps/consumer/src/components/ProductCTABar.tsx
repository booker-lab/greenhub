'use client';

import { Box, Button, Group, Text } from '@mantine/core';

interface Props {
  totalAmount: number;
  isGroup: boolean;
  isFull: boolean;
  canBuy: boolean;
  onAddToCart: () => void;
  onBuyNow: () => void;
}

export default function ProductCTABar({
  totalAmount,
  isGroup,
  isFull,
  canBuy,
  onAddToCart,
  onBuyNow,
}: Props) {
  const ctaLabel = isFull ? '모집 완료' : isGroup ? '공구 참여하기' : '바로 결제';

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
        <Text
          mb={6}
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
        >
          총 금액{' '}
          <Text
            span
            style={{
              fontWeight: 'var(--fw-bold)',
              fontSize: 'var(--font-size-md)',
              color: 'var(--color-text)',
            }}
          >
            {totalAmount.toLocaleString()}원
          </Text>
        </Text>

        {/* 버튼 */}
        <Group gap={8} style={{ flexWrap: 'nowrap' }}>
          <Button flex={1} variant="default" radius="md" size="lg" onClick={onAddToCart}>
            장바구니
          </Button>
          <Button
            flex={2}
            size="lg"
            radius="md"
            disabled={!canBuy}
            onClick={onBuyNow}
            style={{
              backgroundColor: isFull ? 'var(--color-text-disabled)' : 'var(--color-primary)',
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
