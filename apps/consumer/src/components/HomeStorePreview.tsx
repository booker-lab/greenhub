'use client';

import { Box, Card, Group, SimpleGrid, Skeleton, Stack, Text, Title } from '@mantine/core';
import { MapPin, Package, Store } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePublicStores } from '@/hooks/useProducts';

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
            <Card
              key={store.id}
              component={Link}
              href={`/stores/${store.id}`}
              p="sm"
              style={{ border: 'var(--border)', textDecoration: 'none' }}
            >
              <Group wrap="nowrap" align="center">
                <Box
                  style={{
                    position: 'relative',
                    width: 64,
                    height: 64,
                    flex: '0 0 64px',
                    borderRadius: 'var(--radius)',
                    overflow: 'hidden',
                    background: 'var(--color-border)',
                  }}
                >
                  <Image
                    fill
                    src={store.logoUrl ?? '/icons/icon-192x192.png'}
                    alt={store.name || '상점 로고'}
                    sizes="64px"
                    style={{ objectFit: 'cover' }}
                  />
                </Box>
                <Stack gap={5} style={{ minWidth: 0, flex: 1 }}>
                  <Group gap={6} wrap="nowrap">
                    <Store size={15} color="var(--color-primary)" />
                    <Text
                      lineClamp={1}
                      style={{
                        fontSize: 'var(--font-size-md)',
                        fontWeight: 'var(--fw-bold)',
                        color: 'var(--color-text)',
                      }}
                    >
                      {store.name || '이름 없는 상점'}
                    </Text>
                  </Group>
                  <Group gap={6} wrap="nowrap">
                    <MapPin size={14} color="var(--color-text-disabled)" />
                    <Text
                      lineClamp={1}
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {store.address || '주소 미등록'}
                    </Text>
                  </Group>
                  <Group gap={6} wrap="nowrap">
                    <Package size={14} color="var(--color-text-disabled)" />
                    <Text
                      style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary)' }}
                    >
                      상품 {store.productCount}개 · 거점 {store.hubCount}곳
                    </Text>
                  </Group>
                </Stack>
              </Group>
            </Card>
          ))}
        </SimpleGrid>
      )}
    </Box>
  );
}
