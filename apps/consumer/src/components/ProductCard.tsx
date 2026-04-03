'use client'

import Link from 'next/link'
import { Card, Text, Badge, Box } from '@mantine/core'
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
      radius="lg"
      p={0}
      style={{ overflow: 'hidden', display: 'block', textDecoration: 'none' }}
      withBorder
    >
      {/* 이미지 */}
      <Box style={{ position: 'relative', aspectRatio: '1', background: 'var(--mantine-color-gray-0)', overflow: 'hidden' }}>
        <img
          src={imgSrc}
          alt={product.name}
          style={{ objectFit: 'cover', width: '100%', height: '100%' }}
        />
        {product.saleType === 'group' && (
          <Badge
            size="xs"
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              background: 'var(--green-primary)',
              color: '#fff',
            }}
          >
            공동구매
          </Badge>
        )}
      </Box>

      {/* 정보 */}
      <Box p="xs">
        <Text size="xs" c="gray.5" mb={2}>
          {categoryLabels[product.category] ?? product.category}
        </Text>
        <Text size="sm" fw={600} c="dark" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {product.name}
        </Text>
        <Text size="md" fw={700} c="brand.8" mt={4}>
          {product.price.toLocaleString()}원
        </Text>
        {product.colors.length > 0 && (
          <Text size="xs" c="gray.5" mt={4} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {product.colors.slice(0, 3).join(' · ')}
            {product.colors.length > 3 && ` +${product.colors.length - 3}`}
          </Text>
        )}
      </Box>
    </Card>
  )
}
