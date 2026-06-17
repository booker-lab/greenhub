'use client';

import { Box, Container, Group, SimpleGrid, Skeleton, Stack, Text, Title } from '@mantine/core';
import { MapPin, Phone, Store } from 'lucide-react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import ProductCard from '@/components/ProductCard';
import { usePublicStore } from '@/hooks/useStores';

const PRODUCT_SKELETON_KEYS = [
  'store-product-skeleton-1',
  'store-product-skeleton-2',
  'store-product-skeleton-3',
  'store-product-skeleton-4',
];

function productHref(productId: string, storeId: string, storeName: string) {
  const params = new URLSearchParams({ fromStore: storeId });
  if (storeName) params.set('storeName', storeName);
  return `/products/${productId}?${params.toString()}`;
}

export default function StoreDetailPage() {
  const params = useParams<{ storeId: string }>();
  const { detail, loading, error } = usePublicStore(params.storeId);

  if (loading) {
    return (
      <Container size="sm" px="md" pt="lg" pb={96}>
        <Skeleton height={156} radius="md" mb="lg" />
        <SimpleGrid cols={2} spacing="sm">
          {PRODUCT_SKELETON_KEYS.map((key) => (
            <Skeleton key={key} height={260} radius="md" />
          ))}
        </SimpleGrid>
      </Container>
    );
  }

  if (error || !detail) {
    return (
      <Container size="sm" px="md" pt="lg" pb={96}>
        <Stack align="center" py={64}>
          <Store size={32} color="var(--color-text-disabled)" />
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            {error ?? '상점을 찾을 수 없습니다.'}
          </Text>
        </Stack>
      </Container>
    );
  }

  const { store, products } = detail;

  return (
    <Container size="sm" px="md" pt="lg" pb={96}>
      <Group wrap="nowrap" align="flex-start" mb="xl">
        <Box
          style={{
            position: 'relative',
            width: 92,
            height: 92,
            flex: '0 0 92px',
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
            background: 'var(--color-border)',
          }}
        >
          <Image
            fill
            src={store.logoUrl ?? '/icons/icon-192x192.png'}
            alt={store.name}
            sizes="92px"
            style={{ objectFit: 'cover' }}
          />
        </Box>
        <Stack gap={6} style={{ minWidth: 0 }}>
          <Title order={3} style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>
            {store.name || '이름 없는 상점'}
          </Title>
          <Group gap={6} wrap="nowrap">
            <MapPin size={14} color="var(--color-text-disabled)" />
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              {store.address || '주소 미등록'}
            </Text>
          </Group>
          {store.phone && (
            <Group gap={6} wrap="nowrap">
              <Phone size={14} color="var(--color-text-disabled)" />
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                {store.phone}
              </Text>
            </Group>
          )}
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary)' }}>
            상품 {store.productCount}개 · 거점 {store.hubCount}곳
          </Text>
        </Stack>
      </Group>

      <Stack gap={4} mb="md">
        <Title order={4} style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>
          판매 상품
        </Title>
      </Stack>

      {products.length === 0 ? (
        <Stack align="center" py={48}>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            판매 중인 상품이 없습니다.
          </Text>
        </Stack>
      ) : (
        <SimpleGrid cols={2} spacing="sm">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              href={productHref(product.id, store.id, store.name)}
            />
          ))}
        </SimpleGrid>
      )}
    </Container>
  );
}
