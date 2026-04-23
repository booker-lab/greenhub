'use client'

import Link from 'next/link'
import { Container, Text, Box, Title, SimpleGrid, Skeleton, Stack, Divider, Group, Badge } from '@mantine/core'
import ProductCard from '@/components/ProductCard'
import BrandHeader from '@/components/BrandHeader'
import HeroBanner from '@/components/HeroBanner'
import DeadlineSection from '@/components/DeadlineSection'
import { useProducts } from '@/hooks/useProducts'

export default function HomePage() {
  const { products, loading, error } = useProducts()
  const { products: groupProducts, loading: groupLoading } = useProducts(undefined, undefined, 'group')

  const activeGroupProducts = groupProducts.filter(
    (p) => !p.groupSummary || p.groupSummary.currentQuantity < p.groupSummary.targetQuantity
  )

  return (
    <Container size="sm" px="md" pt="lg" pb={80}>
      {/* 헤더 */}
      <BrandHeader />

      {/* 히어로 배너 */}
      <HeroBanner />

      {/* 공구 하이라이트 섹션 */}
      {(groupLoading || activeGroupProducts.length > 0) && (
        <Box mb="xl">
          <Group justify="space-between" mb="sm">
            <Group gap={8}>
              <Text fw={700} size="sm" c="dark">⚡ 진행 중 공동구매</Text>
              {!groupLoading && (
                <Badge variant="light" color="brand" size="xs">{activeGroupProducts.length}</Badge>
              )}
            </Group>
            <Text
              component={Link}
              href="/groupbuy"
              size="xs"
              c="brand.6"
              fw={600}
              style={{ textDecoration: 'none' }}
            >
              전체 보기 →
            </Text>
          </Group>

          {groupLoading ? (
            <Group gap="sm" grow>
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} height={200} radius="md" />
              ))}
            </Group>
          ) : (
            <Group gap="sm" grow align="flex-start">
              {activeGroupProducts.slice(0, 3).map((product) => (
                  <Box
                    key={product.id}
                    component={Link}
                    href={`/products/${product.id}`}
                    style={{ textDecoration: 'none', minWidth: 0 }}
                  >
                    <Box
                      style={{
                        aspectRatio: '4/5',
                        borderRadius: 'var(--mantine-radius-md)',
                        overflow: 'hidden',
                        background: 'var(--mantine-color-gray-1)',
                        marginBottom: 6,
                      }}
                    >
                      <img
                        src={product.images?.[0] ?? '/icons/icon-192x192.png'}
                        alt={product.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </Box>
                    <Text size="xs" fw={600} c="dark" lineClamp={2}>{product.name}</Text>
                    <Text size="xs" c="brand.6" fw={500} mt={2}>
                      {product.groupSummary
                        ? `${product.groupSummary.currentQuantity}/${product.groupSummary.targetQuantity}개`
                        : '모집 중'}
                    </Text>
                  </Box>
                ))}
            </Group>
          )}
        </Box>
      )}

      {/* 마감 임박 섹션 */}
      {!groupLoading && <DeadlineSection products={groupProducts} />}

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
