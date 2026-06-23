'use client';

import type { DeliveryMethod } from '@greenhub/shared';
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
import { Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import ProductCard from '@/components/ProductCard';
import { useProducts } from '@/hooks/useProducts';
import CategoryColorFilter from './_color-filter';
import { CATEGORY_TABS } from './_constants';
import CategoryExtendedFilters from './_extended-filters';
import {
  buildActiveCategoryFilters,
  buildCategoryProductHref,
  buildCategoryQuery,
  parseCategoryQuery,
  RESET_CATEGORY_FILTERS_PATCH,
  toggleColor,
} from './_query';
import CategorySortShare from './_sort-share';

const SKELETON_KEYS = [
  'category-skeleton-1',
  'category-skeleton-2',
  'category-skeleton-3',
  'category-skeleton-4',
];

export default function CategoryClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [colorsOpen, setColorsOpen] = useState(false);
  const [priceMinInput, setPriceMinInput] = useState('');
  const [priceMaxInput, setPriceMaxInput] = useState('');
  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const state = useMemo(() => parseCategoryQuery(params), [params]);
  const activeFilters = useMemo(() => buildActiveCategoryFilters(state), [state]);
  const hasActiveFilters = activeFilters.length > 0;
  const { products, total, loading, error } = useProducts(
    state.category,
    state.colors,
    state.saleType,
    state.sort,
    {
      deliveryMethod: state.deliveryMethod,
      priceMax: state.priceMax,
      priceMin: state.priceMin,
    },
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
  const resultCountText =
    total !== visibleProducts.length
      ? `총 ${total}개 · 표시 ${visibleProducts.length}개`
      : `총 ${total}개`;
  const categoryHref = buildCategoryQuery(params, {});

  useEffect(() => {
    setPriceMinInput(state.priceMin === undefined ? '' : String(state.priceMin));
    setPriceMaxInput(state.priceMax === undefined ? '' : String(state.priceMax));
  }, [state.priceMax, state.priceMin]);

  function navigate(
    patch: Parameters<typeof buildCategoryQuery>[1],
    options: { replace?: boolean } = {},
  ) {
    const nextHref = buildCategoryQuery(params, patch);
    if (options.replace) router.replace(nextHref);
    else router.push(nextHref);
  }

  function applyPriceFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(
      {
        priceMax: parsePriceInput(priceMaxInput),
        priceMin: parsePriceInput(priceMinInput),
      },
      { replace: true },
    );
  }

  function toggleDeliveryMethod(deliveryMethod: DeliveryMethod | null) {
    navigate({ deliveryMethod }, { replace: true });
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

      <CategoryColorFilter
        colors={state.colors}
        colorsOpen={colorsOpen}
        onResetColors={() => navigate({ colors: null }, { replace: true })}
        onToggleColor={(color) =>
          navigate({ colors: toggleColor(state.colors, color) }, { replace: true })
        }
        onToggleOpen={() => setColorsOpen((open) => !open)}
      />

      <CategoryExtendedFilters
        deliveryMethod={state.deliveryMethod}
        priceMaxInput={priceMaxInput}
        priceMinInput={priceMinInput}
        setPriceMaxInput={setPriceMaxInput}
        setPriceMinInput={setPriceMinInput}
        onApplyPriceFilter={applyPriceFilter}
        onToggleDeliveryMethod={toggleDeliveryMethod}
      />

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
                component="a"
                href={buildCategoryQuery(params, RESET_CATEGORY_FILTERS_PATCH)}
                data-testid="category-reset-all"
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
                  component="a"
                  href={buildCategoryQuery(params, filter.removePatch)}
                  key={filter.key}
                  data-testid={`category-active-filter-${filter.key}`}
                  aria-label={`${filter.label} 조건 해제`}
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

        <CategorySortShare
          resultCountText={loading ? '상품 불러오는 중' : resultCountText}
          sharePath={categoryHref}
          sort={state.sort}
          onSortChange={(sort) => navigate({ sort }, { replace: true })}
        />

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
              onClick={(event) => {
                if (hasActiveFilters) {
                  event.preventDefault();
                  window.location.assign('/category');
                }
              }}
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
              <ProductCard
                key={product.id}
                href={buildCategoryProductHref(product.id, categoryHref)}
                id={`category-product-${product.id}`}
                product={product}
                variant="discovery"
              />
            ))}
          </SimpleGrid>
        )}
      </Box>
    </Container>
  );
}

function parsePriceInput(value: string) {
  if (!value.trim()) return null;
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : null;
}
