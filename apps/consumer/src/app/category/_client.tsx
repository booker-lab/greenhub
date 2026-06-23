'use client';

import { getGroupBuyStatus } from '@greenhub/shared';
import {
  ActionIcon,
  Box,
  Container,
  Divider,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type CSSProperties, useMemo, useState } from 'react';
import ProductCard from '@/components/ProductCard';
import { useProducts } from '@/hooks/useProducts';
import { CATEGORY_TABS, COLOR_CHIPS, SORT_CHOICES, type SortOption } from './_constants';
import {
  buildActiveCategoryFilters,
  buildCategoryQuery,
  parseCategoryQuery,
  RESET_CATEGORY_FILTERS_PATCH,
  toggleColor,
} from './_query';

const SKELETON_KEYS = [
  'category-skeleton-1',
  'category-skeleton-2',
  'category-skeleton-3',
  'category-skeleton-4',
];

const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export default function CategoryClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [colorsOpen, setColorsOpen] = useState(false);
  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const state = useMemo(() => parseCategoryQuery(params), [params]);
  const activeFilters = useMemo(() => buildActiveCategoryFilters(state), [state]);
  const hasActiveFilters = activeFilters.length > 0;
  const { products, loading, error } = useProducts(
    state.category,
    state.colors,
    state.saleType,
    state.sort,
  );
  const visibleProducts = useMemo(
    () =>
      state.saleType === 'group'
        ? products.filter(
            (product) => getGroupBuyStatus(product.groupSummary).status === 'recruiting',
          )
        : products,
    [products, state.saleType],
  );

  function navigate(
    patch: Parameters<typeof buildCategoryQuery>[1],
    options: { replace?: boolean } = {},
  ) {
    const nextHref = buildCategoryQuery(params, patch);
    if (options.replace) router.replace(nextHref);
    else router.push(nextHref);
  }

  return (
    <Container size="sm" pb={96}>
      <Box
        px="md"
        pt="lg"
        pb="md"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Title order={3} style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>
          카테고리
        </Title>
        <ActionIcon
          component={Link}
          href="/search"
          variant="subtle"
          radius="xl"
          aria-label="상품 검색"
          style={{ color: 'var(--color-text)' }}
        >
          <Search size={18} />
        </ActionIcon>
      </Box>

      <Box px="md" pb="sm" style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
        <Group role="tablist" aria-label="카테고리 필터" gap={0} wrap="nowrap">
          {CATEGORY_TABS.map((tab) => {
            const isActive = state.activeTab === tab.value;
            return (
              <UnstyledButton
                key={tab.value}
                role="tab"
                aria-selected={isActive}
                data-testid={`category-tab-${tab.value}`}
                onClick={() => {
                  if (tab.value === 'all') navigate({ category: null, saleType: null });
                  else if (tab.value === 'group') navigate({ category: null, saleType: 'group' });
                  else navigate({ category: tab.value, saleType: null });
                }}
                style={{
                  flexShrink: 0,
                  padding: '8px 16px',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: isActive ? 'var(--fw-bold)' : 'var(--fw-medium)',
                  color: isActive ? 'var(--color-text)' : 'var(--color-text-disabled)',
                  borderBottom: isActive ? '2px solid var(--color-text)' : '2px solid transparent',
                  transition: 'color 0.15s, border-color 0.15s',
                }}
              >
                {tab.label}
              </UnstyledButton>
            );
          })}
        </Group>
        <Divider mt={0} />
      </Box>

      <Box px="md" py="sm">
        <Group justify="space-between" align="center" wrap="nowrap">
          <UnstyledButton
            aria-expanded={colorsOpen}
            aria-controls="category-color-panel"
            onClick={() => setColorsOpen((open) => !open)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--color-text)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-bold)',
            }}
          >
            색상
            {state.colors.length > 0 && (
              <Text span style={{ color: 'var(--color-primary)', fontWeight: 'var(--fw-bold)' }}>
                {state.colors.length}
              </Text>
            )}
            {colorsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </UnstyledButton>
          {state.colors.length > 0 && (
            <UnstyledButton
              data-testid="category-reset-colors"
              onClick={() => navigate({ colors: null }, { replace: true })}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: 'var(--color-text-secondary)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
              }}
            >
              <X size={14} />
              초기화
            </UnstyledButton>
          )}
        </Group>

        {!colorsOpen && state.colors.length > 0 && (
          <Text mt={6} style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary)' }}>
            {state.colors.join(' · ')}
          </Text>
        )}

        {colorsOpen && (
          <Box
            id="category-color-panel"
            mt="sm"
            style={{ overflowX: 'auto', scrollbarWidth: 'none' }}
          >
            <Group gap={12} wrap="nowrap">
              {COLOR_CHIPS.map((chip) => {
                const isActive = state.colors.includes(chip.value);
                return (
                  <UnstyledButton
                    key={chip.value}
                    aria-pressed={isActive}
                    data-testid={`category-color-${chip.value}`}
                    onClick={() =>
                      navigate({ colors: toggleColor(state.colors, chip.value) }, { replace: true })
                    }
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
                        outline: isActive
                          ? '2px solid var(--color-primary)'
                          : '2px solid transparent',
                        outlineOffset: 2,
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
                );
              })}
            </Group>
          </Box>
        )}
      </Box>

      <Divider mb="md" />

      <Box px="md">
        {hasActiveFilters && (
          <Box mb="md">
            <Group justify="space-between" align="center" mb={8}>
              <Text
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-secondary)',
                  fontWeight: 'var(--fw-bold)',
                }}
              >
                적용한 조건
              </Text>
              <UnstyledButton
                data-testid="category-reset-all"
                onClick={() => navigate(RESET_CATEGORY_FILTERS_PATCH, { replace: true })}
                style={{
                  color: 'var(--color-primary)',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-bold)',
                }}
              >
                전체 초기화
              </UnstyledButton>
            </Group>
            <Group gap={8}>
              {activeFilters.map((filter) => (
                <UnstyledButton
                  key={filter.key}
                  data-testid={`category-active-filter-${filter.key}`}
                  aria-label={`${filter.label} 조건 해제`}
                  onClick={() => navigate(filter.removePatch, { replace: true })}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    maxWidth: '100%',
                    minHeight: 32,
                    padding: '6px 10px',
                    border: 'var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--color-bg-muted)',
                    color: 'var(--color-text)',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--fw-medium)',
                  }}
                >
                  <Text span truncate style={{ maxWidth: 160 }}>
                    {filter.label}
                  </Text>
                  <X size={14} aria-hidden />
                </UnstyledButton>
              ))}
            </Group>
          </Box>
        )}

        <Group justify="space-between" align="center" mb="sm">
          <Text
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-disabled)',
              fontWeight: 'var(--fw-medium)',
            }}
          >
            {loading ? '상품 불러오는 중' : `총 ${visibleProducts.length}개`}
          </Text>
          <Box style={{ position: 'relative' }}>
            <label htmlFor="category-sort" style={visuallyHidden}>
              상품 정렬
            </label>
            <select
              id="category-sort"
              data-testid="category-sort"
              value={state.sort}
              onChange={(event) =>
                navigate({ sort: event.currentTarget.value as SortOption }, { replace: true })
              }
              style={{
                height: 34,
                border: 'var(--border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                padding: '0 28px 0 10px',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
              }}
            >
              {SORT_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </Box>
        </Group>

        {loading && (
          <SimpleGrid cols={2} spacing="sm">
            {SKELETON_KEYS.map((key) => (
              <Skeleton key={key} height={260} radius="md" />
            ))}
          </SimpleGrid>
        )}

        {!loading && error && (
          <Stack align="center" py={48}>
            <Text
              ta="center"
              style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
            >
              {error}
            </Text>
          </Stack>
        )}

        {!loading && !error && visibleProducts.length === 0 && (
          <Stack align="center" py={64}>
            <Text size="xl">🌱</Text>
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              {hasActiveFilters
                ? '선택한 조건에 맞는 상품이 없습니다. 조건을 하나씩 해제해 보세요.'
                : '아직 등록된 상품이 없습니다.'}
            </Text>
            <UnstyledButton
              component={Link}
              href="/category"
              data-testid="category-empty-reset"
              style={{
                color: 'var(--color-primary)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
              }}
            >
              {hasActiveFilters ? '전체 조건 초기화' : '전체 상품 보기'}
            </UnstyledButton>
          </Stack>
        )}

        {!loading && visibleProducts.length > 0 && (
          <SimpleGrid cols={2} spacing="sm">
            {visibleProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </SimpleGrid>
        )}
      </Box>
    </Container>
  );
}
