'use client';

import {
  Box,
  Card,
  Container,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { MapPin, Package, Store } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePublicStores } from '@/hooks/useStores';

const STORE_SKELETON_KEYS = [
  'store-skeleton-1',
  'store-skeleton-2',
  'store-skeleton-3',
  'store-skeleton-4',
];

export default function StoresPage() {
  const { stores, loading, error } = usePublicStores();

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

      {!loading && stores.length > 0 && (
        <SimpleGrid cols={1} spacing="sm">
          {stores.map((store) => (
            <Card
              key={store.id}
              component={Link}
              href={`/stores/${store.id}`}
              p="sm"
              style={{ border: 'var(--border)', textDecoration: 'none' }}
            >
              <Group wrap="nowrap" align="stretch">
                <Box
                  style={{
                    position: 'relative',
                    width: 84,
                    flex: '0 0 84px',
                    borderRadius: 'var(--radius)',
                    overflow: 'hidden',
                    background: 'var(--color-border)',
                  }}
                >
                  <Image
                    fill
                    src={store.logoUrl ?? '/icons/icon-192x192.png'}
                    alt={store.name}
                    sizes="84px"
                    style={{ objectFit: 'cover' }}
                  />
                </Box>
                <Stack gap={6} style={{ minWidth: 0, flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 'var(--font-size-md)',
                      fontWeight: 'var(--fw-bold)',
                      color: 'var(--color-text)',
                    }}
                    lineClamp={1}
                  >
                    {store.name || '이름 없는 상점'}
                  </Text>
                  <Group gap={6} wrap="nowrap">
                    <MapPin size={14} color="var(--color-text-disabled)" />
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-secondary)',
                      }}
                      lineClamp={1}
                    >
                      {store.address || '주소 미등록'}
                    </Text>
                  </Group>
                  <Group gap="xs">
                    <Text
                      style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary)' }}
                    >
                      상품 {store.productCount}개
                    </Text>
                    <Text
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-disabled)',
                      }}
                    >
                      거점 {store.hubCount}곳
                    </Text>
                  </Group>
                </Stack>
                <Package size={18} color="var(--color-text-disabled)" />
              </Group>
            </Card>
          ))}
        </SimpleGrid>
      )}
    </Container>
  );
}
