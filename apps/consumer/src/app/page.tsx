'use client'

import { Container, Text, Box, Title, SimpleGrid, Skeleton, Stack, Divider } from '@mantine/core'
import ProductCard from '@/components/ProductCard'
import BrandHeader from '@/components/BrandHeader'
import { useProducts } from '@/hooks/useProducts'

export default function HomePage() {
  const { products, loading, error } = useProducts()

  return (
    <Container size="sm" px="md" pt="lg" pb={80}>
      {/* 헤더 */}
      <BrandHeader />

      {/* 공동구매 안내 배너 */}
      <Box
        mb="xl"
        p="lg"
        style={{
          background: 'var(--mantine-color-gray-0)',
          borderRadius: 'var(--mantine-radius-md)',
          borderLeft: '4px solid var(--mantine-color-brand-6)',
        }}
      >
        <Text fw={700} size="sm" c="brand.7" mb={4}>공동구매란?</Text>
        <Text size="sm" c="gray.6" style={{ lineHeight: 1.6 }}>
          함께 구매하면 배송비를 절약할 수 있어요.
          최소 인원이 모이면 주문이 확정됩니다.
        </Text>
      </Box>

      {/* 상품 목록 */}
      <Box>
        <Stack gap={4} mb="md">
          <Title order={4} fw={700} c="dark">전체 상품</Title>
          <Divider />
        </Stack>

        {loading && (
          <SimpleGrid cols={2} spacing="sm">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} height={260} radius="md" />
            ))}
          </SimpleGrid>
        )}

        {error && (
          <Stack align="center" py={48}>
            <Text size="sm" c="gray.4">{error}</Text>
          </Stack>
        )}

        {!loading && !error && products.length === 0 && (
          <Stack align="center" py={48}>
            <Text size="xl">🌱</Text>
            <Text size="sm" c="gray.4">등록된 상품이 없습니다.</Text>
          </Stack>
        )}

        {!loading && products.length > 0 && (
          <SimpleGrid cols={2} spacing="sm">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </SimpleGrid>
        )}
      </Box>
    </Container>
  )
}
