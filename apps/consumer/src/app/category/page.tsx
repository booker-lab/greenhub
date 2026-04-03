'use client'

import { useState } from 'react'
import { Container, Box, Title, Text, Button, Group, SimpleGrid, Skeleton, Stack } from '@mantine/core'
import ProductCard from '@/components/ProductCard'
import { useProducts } from '@/hooks/useProducts'
import type { Category } from '@greenhub/shared'

const TABS: { label: string; value: Category | undefined }[] = [
  { label: '전체', value: undefined },
  { label: '절화', value: 'cut_flower' },
  { label: '난', value: 'orchid' },
  { label: '관엽', value: 'foliage' },
]

export default function CategoryPage() {
  const [selected, setSelected] = useState<Category | undefined>(undefined)
  const { products, loading, error } = useProducts(selected)

  return (
    <Container size="sm" pb={96}>
      {/* 헤더 */}
      <Box px="md" pt="lg" pb="sm">
        <Title order={2} c="dark">카테고리</Title>
      </Box>

      {/* 카테고리 탭 */}
      <Box px="md" pb="md" style={{ overflowX: 'auto' }}>
        <Group gap="xs" wrap="nowrap">
          {TABS.map((tab) => {
            const isActive = selected === tab.value
            return (
              <Button
                key={tab.label}
                size="sm"
                radius="xl"
                variant={isActive ? 'filled' : 'outline'}
                color={isActive ? 'brand' : 'gray'}
                onClick={() => setSelected(tab.value)}
                style={{ flexShrink: 0 }}
              >
                {tab.label}
              </Button>
            )
          })}
        </Group>
      </Box>

      {/* 상품 목록 */}
      <Box px="md">
        {loading && (
          <SimpleGrid cols={2} spacing="sm">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} height={200} radius="lg" />
            ))}
          </SimpleGrid>
        )}

        {!loading && error && (
          <Text ta="center" py={48} c="gray.4" size="sm">{error}</Text>
        )}

        {!loading && !error && products.length === 0 && (
          <Stack align="center" py={64}>
            <Text size="xl">🌱</Text>
            <Text size="sm" c="gray.4">해당 카테고리 상품이 없습니다.</Text>
          </Stack>
        )}

        {!loading && products.length > 0 && (
          <>
            <Text size="xs" c="gray.4" mb="sm">{products.length}개 상품</Text>
            <SimpleGrid cols={2} spacing="sm">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </SimpleGrid>
          </>
        )}
      </Box>
    </Container>
  )
}
