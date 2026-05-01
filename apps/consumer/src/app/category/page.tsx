'use client'

import { useState } from 'react'
import { Container, Box, Title, Text, Group, SimpleGrid, Skeleton, Stack, Divider, UnstyledButton } from '@mantine/core'
import ProductCard from '@/components/ProductCard'
import { useProducts } from '@/hooks/useProducts'
import type { Category, ColorOption } from '@greenhub/shared'

const TABS: { label: string; value: Category | undefined; saleType?: 'group' | 'direct' }[] = [
  { label: '전체', value: undefined },
  { label: '공동구매', value: undefined, saleType: 'group' },
  { label: '절화', value: 'cut_flower' },
  { label: '난', value: 'orchid' },
  { label: '관엽', value: 'foliage' },
]

// 꽃 색상 데이터 — hex 유지 필수 (브랜드 컬러 예외)
const COLOR_CHIPS: { label: string; value: ColorOption; hex: string }[] = [
  { label: '레드', value: '레드', hex: '#E53E3E' },
  { label: '핑크', value: '핑크', hex: '#ED64A6' },
  { label: '화이트', value: '화이트', hex: '#EDF2F7' },
  { label: '옐로우', value: '옐로우', hex: '#ECC94B' },
  { label: '오렌지', value: '오렌지', hex: '#ED8936' },
  { label: '퍼플', value: '퍼플', hex: '#805AD5' },
  { label: '블루', value: '블루', hex: '#4299E1' },
  { label: '그린', value: '그린', hex: '#48BB78' },
  { label: '무늬', value: '무늬', hex: '#B794F4' },
  { label: '브라운', value: '브라운', hex: '#975A16' },
  { label: '베이지', value: '베이지', hex: '#FEFCBF' },
  { label: '블랙', value: '블랙', hex: '#1A202C' },
  { label: '그레이', value: '그레이', hex: '#A0AEC0' },
]

export default function CategoryPage() {
  const [selectedTab, setSelectedTab] = useState(0)
  const [selectedColors, setSelectedColors] = useState<ColorOption[]>([])

  const activeTab = TABS[selectedTab]
  const { products, loading, error } = useProducts(activeTab.value, selectedColors, activeTab.saleType)

  function toggleColor(color: ColorOption) {
    setSelectedColors((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color]
    )
  }

  return (
    <Container size="sm" pb={96}>
      {/* 헤더 */}
      <Box px="md" pt="lg" pb="md">
        <Title order={3} style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>카테고리</Title>
      </Box>

      {/* 카테고리 탭 */}
      <Box
        px="md"
        pb="sm"
        style={{ overflowX: 'auto', scrollbarWidth: 'none' }}
      >
        <Group gap={0} wrap="nowrap">
          {TABS.map((tab, idx) => {
            const isActive = selectedTab === idx
            return (
              <UnstyledButton
                key={tab.label}
                onClick={() => setSelectedTab(idx)}
                style={{
                  flexShrink: 0,
                  padding: '8px 16px',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: isActive ? 'var(--fw-bold)' : 'normal',
                  color: isActive ? 'var(--color-text)' : 'var(--color-text-disabled)',
                  borderBottom: isActive
                    ? '2px solid var(--color-text)'
                    : '2px solid transparent',
                  transition: 'all 0.15s',
                }}
              >
                {tab.label}
              </UnstyledButton>
            )
          })}
        </Group>
        <Divider mt={0} />
      </Box>

      {/* 색상 필터 */}
      <Box
        px="md"
        py="sm"
        mb="sm"
        style={{ overflowX: 'auto', scrollbarWidth: 'none' }}
      >
        <Group gap={12} wrap="nowrap">
          {COLOR_CHIPS.map((chip) => {
            const isActive = selectedColors.includes(chip.value)
            return (
              <UnstyledButton
                key={chip.value}
                onClick={() => toggleColor(chip.value)}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <Box
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    backgroundColor: chip.hex,
                    border: isActive
                      ? '2px solid var(--color-text)'
                      : '2px solid var(--color-border)',
                    outline: isActive ? '2px solid var(--color-text)' : '2px solid transparent',
                    outlineOffset: 2,
                    transition: 'outline 0.1s',
                  }}
                />
                <Text
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: isActive ? 'var(--color-text)' : 'var(--color-text-disabled)',
                    fontWeight: isActive ? 'var(--fw-bold)' : 'var(--fw-medium)',
                  }}
                >
                  {chip.label}
                </Text>
              </UnstyledButton>
            )
          })}
        </Group>
      </Box>

      <Divider mb="md" />

      {/* 상품 목록 */}
      <Box px="md">
        {loading && (
          <SimpleGrid cols={2} spacing="sm">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} height={260} radius="md" />
            ))}
          </SimpleGrid>
        )}

        {!loading && error && (
          <Text ta="center" py={48} style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}>{error}</Text>
        )}

        {!loading && !error && products.length === 0 && (
          <Stack align="center" py={64}>
            <Text size="xl">🌱</Text>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>해당 카테고리 상품이 없습니다.</Text>
          </Stack>
        )}

        {!loading && products.length > 0 && (
          <>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)', fontWeight: 'var(--fw-medium)' }} mb="sm">{products.length}개 상품</Text>
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
