'use client'

import { Box, Button, Group, Text } from '@mantine/core'

interface Props {
  totalAmount: number
  isGroup: boolean
  isFull: boolean
  canBuy: boolean
  onAddToCart: () => void
  onBuyNow: () => void
}

export default function ProductCTABar({
  totalAmount,
  isGroup,
  isFull,
  canBuy,
  onAddToCart,
  onBuyNow,
}: Props) {
  const ctaLabel = isFull ? '모집 완료' : isGroup ? '공구 참여하기' : '바로 결제'

  return (
    <Box
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        backgroundColor: 'var(--mantine-color-white)',
        boxShadow: '0 -2px 12px rgba(0,0,0,0.08)',
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
        <Text size="xs" c="gray.5" mb={6}>
          총 금액{' '}
          <Text span fw={700} size="sm" c="dark">
            {totalAmount.toLocaleString()}원
          </Text>
        </Text>

        {/* 버튼 */}
        <Group gap={8} style={{ flexWrap: 'nowrap' }}>
          <Button
            flex={1}
            variant="default"
            radius="md"
            size="md"
            onClick={onAddToCart}
          >
            장바구니
          </Button>
          <Button
            flex={2}
            color="brand"
            radius="md"
            size="md"
            disabled={!canBuy}
            onClick={onBuyNow}
            style={isFull ? { backgroundColor: 'var(--mantine-color-gray-5)' } : undefined}
          >
            {ctaLabel}
          </Button>
        </Group>
      </Box>
    </Box>
  )
}
