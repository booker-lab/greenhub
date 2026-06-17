'use client';

import { Box, Group, SimpleGrid, Skeleton, Stack, Text, Title } from '@mantine/core';
import Link from 'next/link';
import StoreCard from '@/components/StoreCard';
import { usePublicStores } from '@/hooks/useStores';

const STORE_PREVIEW_LIMIT = 3;
const STORE_PREVIEW_SKELETON_KEYS = [
  'home-store-skeleton-1',
  'home-store-skeleton-2',
  'home-store-skeleton-3',
];

export default function HomeStorePreview() {
  const { stores, loading, error } = usePublicStores();
  const visibleStores = stores.slice(0, STORE_PREVIEW_LIMIT);

  if (!loading && (error || visibleStores.length === 0)) {
    return null;
  }

  return (
    <Box mb="xl">
      <Group justify="space-between" align="center" mb="sm">
        <Stack gap={2}>
          <Title order={4} style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>
            상점 둘러보기
          </Title>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            판매자별 상품을 확인하세요.
          </Text>
        </Stack>
        <Link
          href="/stores"
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-primary)',
            fontWeight: 'var(--fw-bold)',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          전체 보기 →
        </Link>
      </Group>

      {loading ? (
        <SimpleGrid cols={1} spacing="sm">
          {STORE_PREVIEW_SKELETON_KEYS.map((key) => (
            <Skeleton key={key} height={104} radius="md" />
          ))}
        </SimpleGrid>
      ) : (
        <SimpleGrid cols={1} spacing="sm">
          {visibleStores.map((store) => (
            <StoreCard key={store.id} store={store} compact />
          ))}
        </SimpleGrid>
      )}
    </Box>
  );
}
