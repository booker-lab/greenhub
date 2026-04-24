'use client'

import { useState, useMemo } from 'react'
import { Container, Box, TextInput, ActionIcon, Text, SimpleGrid, Stack } from '@mantine/core'
import { Search } from 'lucide-react'
import ProductCard from '@/components/ProductCard'
import { useProducts } from '@/hooks/useProducts'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const { products, loading, error } = useProducts()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q),
    )
  }, [query, products])

  const hasQuery = query.trim().length > 0

  return (
    <Container size="sm" pb={96}>
      {/* 검색창 */}
      <Box
        px="md"
        pt="lg"
        pb="sm"
        style={{
          position: 'sticky',
          top: 0,
          backgroundColor: 'var(--color-bg)',
          zIndex: 10,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="상품명을 검색하세요"
          autoFocus
          radius="lg"
          leftSection={<Search size={16} />}
          rightSection={
            query ? (
              <ActionIcon variant="transparent" style={{ color: 'var(--color-text-secondary)' }} onClick={() => setQuery('')} size="sm">
                ✕
              </ActionIcon>
            ) : null
          }
        />
      </Box>

      {/* 결과 영역 */}
      <Box px="md" pt="md">
        {loading && (
          <Text ta="center" py={48} style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}>불러오는 중...</Text>
        )}

        {!loading && error && (
          <Text ta="center" py={48} style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}>{error}</Text>
        )}

        {!loading && !error && !hasQuery && (
          <Stack align="center" py={64}>
            <Text size="xl">🔍</Text>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>찾고 싶은 상품을 검색해보세요.</Text>
          </Stack>
        )}

        {!loading && hasQuery && filtered.length === 0 && (
          <Stack align="center" py={64}>
            <Text size="xl">😢</Text>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              <Text span style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>"{query}"</Text>에 대한 검색 결과가 없습니다.
            </Text>
          </Stack>
        )}

        {!loading && hasQuery && filtered.length > 0 && (
          <>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }} mb="sm">
              <Text span style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>"{query}"</Text> 검색 결과 {filtered.length}개
            </Text>
            <SimpleGrid cols={2} spacing="sm">
              {filtered.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </SimpleGrid>
          </>
        )}
      </Box>
    </Container>
  )
}
