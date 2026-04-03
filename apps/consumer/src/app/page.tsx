'use client'

import { Container, Title, Text, Box, Paper, SimpleGrid, Skeleton, Stack } from '@mantine/core'
import ProductCard from '@/components/ProductCard'
import { useProducts } from '@/hooks/useProducts'

export default function HomePage() {
  const { products, loading, error } = useProducts()

  return (
    <Container size="sm" px="md" pt="lg" pb="md">
      {/* 헤더 */}
      <Box mb="lg">
        <Title order={1} size="h2" c="brand.6">Green Hub</Title>
        <Text size="sm" c="gray.6" mt={4}>신선한 화훼, 직거래로 만나세요.</Text>
      </Box>

      {/* 공동구매 안내 배너 */}
      <Paper
        radius="lg"
        p="lg"
        mb="lg"
        style={{
          background: 'linear-gradient(to right, var(--green-primary), var(--green-dark))',
          color: '#fff',
        }}
      >
        <Text fw={700} size="lg" mb={4}>🌿 공동구매</Text>
        <Text size="sm" style={{ opacity: 0.9 }}>
          함께 구매하면 배송비를 절약할 수 있어요.
        </Text>
      </Paper>

      {/* 상품 목록 */}
      <Box>
        <Text fw={700} size="lg" mb="sm">전체 상품</Text>

        {loading && (
          <SimpleGrid cols={2} spacing="sm">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} height={200} radius="lg" />
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
