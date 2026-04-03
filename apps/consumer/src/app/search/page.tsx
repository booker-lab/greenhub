'use client'

import { useState, useMemo } from 'react'
import { Container, Box, TextInput, ActionIcon, Text, SimpleGrid, Stack } from '@mantine/core'
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
          backgroundColor: 'var(--mantine-color-white)',
          zIndex: 10,
          borderBottom: '1px solid var(--mantine-color-gray-1)',
        }}
      >
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="상품명을 검색하세요"
          autoFocus
          radius="lg"
          leftSection={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          }
          rightSection={
            query ? (
              <ActionIcon variant="transparent" c="gray" onClick={() => setQuery('')} size="sm">
                ✕
              </ActionIcon>
            ) : null
          }
        />
      </Box>

      {/* 결과 영역 */}
      <Box px="md" pt="md">
        {loading && (
          <Text ta="center" py={48} c="gray.4" size="sm">불러오는 중...</Text>
        )}

        {!loading && error && (
          <Text ta="center" py={48} c="gray.4" size="sm">{error}</Text>
        )}

        {!loading && !error && !hasQuery && (
          <Stack align="center" py={64}>
            <Text size="xl">🔍</Text>
            <Text size="sm" c="gray.4">찾고 싶은 상품을 검색해보세요.</Text>
          </Stack>
        )}

        {!loading && hasQuery && filtered.length === 0 && (
          <Stack align="center" py={64}>
            <Text size="xl">😢</Text>
            <Text size="sm" c="gray.4">
              <Text span fw={600} c="dark">"{query}"</Text>에 대한 검색 결과가 없습니다.
            </Text>
          </Stack>
        )}

        {!loading && hasQuery && filtered.length > 0 && (
          <>
            <Text size="xs" c="gray.4" mb="sm">
              <Text span fw={600} c="dark">"{query}"</Text> 검색 결과 {filtered.length}개
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
