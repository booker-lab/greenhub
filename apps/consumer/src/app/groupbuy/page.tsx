'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Container, Box, Title, Text, SimpleGrid, Skeleton, Stack, Group, Badge } from '@mantine/core'
import ProductCard from '@/components/ProductCard'
import { useProducts } from '@/hooks/useProducts'

export default function GroupBuyPage() {
  const { products, loading, error } = useProducts(undefined, undefined, 'group')

  const { active, full } = useMemo(() => {
    const active = products.filter(
      (p) => !p.groupSummary || p.groupSummary.currentQuantity < p.groupSummary.targetQuantity
    )
    const full = products.filter(
      (p) => p.groupSummary && p.groupSummary.currentQuantity >= p.groupSummary.targetQuantity
    )
    return { active, full }
  }, [products])

  return (
    <Container size="sm" px="md" pt="lg" pb={80}>
      {/* 히어로 배너 */}
      <Box
        mb="xl"
        p="lg"
        style={{
          background: 'linear-gradient(135deg, var(--mantine-color-brand-0) 0%, var(--mantine-color-brand-1) 100%)',
          borderRadius: 'var(--mantine-radius-lg)',
          border: '1px solid var(--mantine-color-brand-2)',
        }}
      >
        <Group gap={8} mb={6}>
          <Text fw={800} size="lg" c="brand.8">⚡ 공동구매</Text>
          <Badge variant="filled" color="brand" size="sm" radius="sm">진행 중</Badge>
        </Group>
        <Text size="sm" c="brand.7" style={{ lineHeight: 1.6 }}>
          함께 모이면 더 저렴하게! 목표 수량이 채워지면 주문이 확정됩니다.
        </Text>
        <Text size="xs" c="brand.5" mt={8}>
          현재 {loading ? '...' : `${products.length}개`} 공구 진행 중
        </Text>
      </Box>

      {/* 로딩 */}
      {loading && (
        <SimpleGrid cols={2} spacing="sm">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} height={260} radius="md" />
          ))}
        </SimpleGrid>
      )}

      {/* 에러 */}
      {!loading && error && (
        <Stack align="center" py={48}>
          <Text size="sm" c="gray.4">{error}</Text>
        </Stack>
      )}

      {/* 빈 상태 */}
      {!loading && !error && products.length === 0 && (
        <Stack align="center" py={64}>
          <Text size="2xl">🌱</Text>
          <Text size="sm" c="gray.4">진행 중인 공동구매가 없습니다.</Text>
          <Text size="xs" c="gray.3">
            <Link href="/" style={{ color: 'inherit' }}>전체 상품 보기</Link>
          </Text>
        </Stack>
      )}

      {/* 모집 중 상품 */}
      {!loading && active.length > 0 && (
        <Box mb="xl">
          <Stack gap={4} mb="md">
            <Group gap={8}>
              <Title order={5} fw={700} c="dark">모집 중</Title>
              <Badge variant="light" color="brand" size="sm">{active.length}</Badge>
            </Group>
          </Stack>
          <SimpleGrid cols={2} spacing="sm">
            {active.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </SimpleGrid>
        </Box>
      )}

      {/* 모집 완료 상품 */}
      {!loading && full.length > 0 && (
        <Box>
          <Stack gap={4} mb="md">
            <Group gap={8}>
              <Title order={5} fw={700} c="gray.5">모집 완료</Title>
              <Badge variant="light" color="gray" size="sm">{full.length}</Badge>
            </Group>
          </Stack>
          <SimpleGrid cols={2} spacing="sm" style={{ opacity: 0.6 }}>
            {full.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </SimpleGrid>
        </Box>
      )}
    </Container>
  )
}
