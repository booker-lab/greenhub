'use client';

import {
  Button,
  Container,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { RotateCcw, Search, Store } from 'lucide-react';
import { useMemo, useState } from 'react';
import StoreCard from '@/components/StoreCard';
import { usePublicStores } from '@/hooks/useStores';

const STORE_SKELETON_KEYS = [
  'store-skeleton-1',
  'store-skeleton-2',
  'store-skeleton-3',
  'store-skeleton-4',
];

type StoreSort = 'name' | 'products' | 'hubs';

const STORE_SORT_OPTIONS = [
  { value: 'name', label: '가나다순' },
  { value: 'products', label: '구매 가능순' },
  { value: 'hubs', label: '거점 수순' },
] as const;

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase('ko-KR');
}

function compareStoreAvailability(a: { productCount: number }, b: { productCount: number }) {
  return Number(b.productCount > 0) - Number(a.productCount > 0);
}

export default function StoresPage() {
  const { stores, loading, error } = usePublicStores();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<StoreSort>('name');
  const normalizedQuery = normalizeSearch(query);
  const visibleStores = useMemo(() => {
    const filtered = normalizedQuery
      ? stores.filter((store) =>
          `${store.name} ${store.address}`.toLocaleLowerCase('ko-KR').includes(normalizedQuery),
        )
      : stores;

    return [...filtered].sort((a, b) => {
      const availability = compareStoreAvailability(a, b);
      if (availability !== 0) return availability;
      if (sort === 'products')
        return b.productCount - a.productCount || a.name.localeCompare(b.name, 'ko-KR');
      if (sort === 'hubs') return b.hubCount - a.hubCount || a.name.localeCompare(b.name, 'ko-KR');
      return a.name.localeCompare(b.name, 'ko-KR');
    });
  }, [stores, normalizedQuery, sort]);
  const hasSearch = normalizedQuery.length > 0;

  return (
    <Container size="sm" px="md" pt="lg" pb={96}>
      <Stack gap={4} mb="md">
        <Title order={3} style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>
          상점
        </Title>
        <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          판매자별 상품과 운영 거점을 확인하세요.
        </Text>
      </Stack>

      {!loading && !error && stores.length > 0 && (
        <Stack gap="xs" mb="md">
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="상점명 또는 주소 검색"
            leftSection={<Search size={16} />}
            aria-label="상점 검색"
          />
          <Group gap={6} role="radiogroup" aria-label="상점 정렬" wrap="nowrap">
            {STORE_SORT_OPTIONS.map((option) => {
              const selected = sort === option.value;
              return (
                <Button
                  key={option.value}
                  type="button"
                  size="xs"
                  variant={selected ? 'filled' : 'default'}
                  color={selected ? 'brand' : undefined}
                  radius="xl"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setSort(option.value)}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  {option.label}
                </Button>
              );
            })}
          </Group>
        </Stack>
      )}

      {loading && (
        <SimpleGrid cols={1} spacing="sm">
          {STORE_SKELETON_KEYS.map((key) => (
            <Skeleton key={key} height={132} radius="md" />
          ))}
        </SimpleGrid>
      )}

      {!loading && error && (
        <Text ta="center" py={48} style={{ color: 'var(--color-text-disabled)' }}>
          {error}
        </Text>
      )}

      {!loading && !error && stores.length === 0 && (
        <Stack align="center" py={64}>
          <Store size={32} color="var(--color-text-disabled)" />
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            운영 중인 상점이 없습니다.
          </Text>
        </Stack>
      )}

      {!loading && !error && stores.length > 0 && visibleStores.length === 0 && (
        <Stack align="center" py={48}>
          <Store size={32} color="var(--color-text-disabled)" />
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            검색 조건에 맞는 상점이 없습니다.
          </Text>
          {hasSearch && (
            <Button
              variant="light"
              leftSection={<RotateCcw size={16} />}
              onClick={() => setQuery('')}
            >
              검색 초기화
            </Button>
          )}
        </Stack>
      )}

      {!loading && !error && visibleStores.length > 0 && (
        <SimpleGrid cols={1} spacing="sm">
          {visibleStores.map((store) => (
            <StoreCard key={store.id} store={store} />
          ))}
        </SimpleGrid>
      )}
    </Container>
  );
}
