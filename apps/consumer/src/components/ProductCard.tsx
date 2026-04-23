'use client'

import Link from 'next/link'
import { Card, Text, Badge, Box, Group } from '@mantine/core'
import type { Product } from '@greenhub/shared'

interface ProductCardProps {
  product: Product
}

const categoryLabels: Record<string, string> = {
  cut_flower: '절화',
  orchid: '난',
  foliage: '관엽',
}

export default function ProductCard({ product }: ProductCardProps) {
  const imgSrc = product.images?.[0] ?? '/icons/icon-192x192.png'

  return (
    <Card
      component={Link}
      href={`/products/${product.id}`}
      radius="md"
      p={0}
      shadow="sm"
      style={{ overflow: 'hidden', display: 'block', textDecoration: 'none' }}
    >
      {/* 이미지 */}
      <Box style={{ position: 'relative', aspectRatio: '4/5', background: 'var(--mantine-color-gray-0)', overflow: 'hidden' }}>
        <img
          src={imgSrc}
          alt={product.name}
          style={{ objectFit: 'cover', width: '100%', height: '100%' }}
        />
      </Box>

      {/* 정보 */}
      <Box p="xs">
        <Group gap={4} mb={4}>
          <Badge size="sm" variant="light" color="gray" radius="sm">
            {categoryLabels[product.category] ?? product.category}
          </Badge>
          {product.saleType === 'group' && (
            <Badge size="sm" variant="filled" color="green" radius="sm">
              공동구매
            </Badge>
          )}
        </Group>
        <Text size="md" fw={600} c="dark" style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {product.name}
        </Text>
        <Text size="sm" fw={700} c="gray.7" mt={4}>
          {product.price.toLocaleString()}원
        </Text>
        {(() => {
          const colors = product.selection?.colors ?? product.colors ?? []
          return colors.length > 0 ? (
            <Text size="xs" c="gray.5" mt={4} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {colors.slice(0, 3).join(' · ')}
              {colors.length > 3 && ` +${colors.length - 3}`}
            </Text>
          ) : null
        })()}
        {product.saleType === 'group' && product.groupSummary && (
          <Text size="xs" c="brand.6" mt={4} fw={500}>
            {product.groupSummary.currentQuantity >= product.groupSummary.targetQuantity
              ? '모집 완료'
              : `${product.groupSummary.currentQuantity}/${product.groupSummary.targetQuantity}개 모집 중`}
          </Text>
        )}
      </Box>
    </Card>
  )
}
