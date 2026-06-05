'use client';

import { Box, Divider, SimpleGrid, Skeleton, Stack, Title } from '@mantine/core';
import Image from 'next/image';
import Link from 'next/link';
import DeadlineSection from '@/components/DeadlineSection';
import HomeStorePreview from '@/components/HomeStorePreview';
import ProductCard from '@/components/ProductCard';
import { useProducts } from '@/hooks/useProducts';

const GROUP_SKELETON_KEYS = ['group-skeleton-1', 'group-skeleton-2', 'group-skeleton-3'];
const PRODUCT_SKELETON_KEYS = [
  'home-product-skeleton-1',
  'home-product-skeleton-2',
  'home-product-skeleton-3',
  'home-product-skeleton-4',
];

export default function HomeProductList() {
  const { products, loading, error } = useProducts();
  const { products: groupProducts, loading: groupLoading } = useProducts(
    undefined,
    undefined,
    'group',
  );

  const activeGroupProducts = groupProducts.filter(
    (p) => !p.groupSummary || p.groupSummary.currentQuantity < p.groupSummary.targetQuantity,
  );

  return (
    <>
      {(groupLoading || activeGroupProducts.length > 0) && (
        <Box mb="xl">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 'var(--fw-bold)',
                  color: 'var(--color-text)',
                }}
              >
                ⚡ 진행 중 공동구매
              </span>
              {!groupLoading && (
                <span
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--fw-medium)',
                    color: 'var(--color-primary)',
                    background: 'var(--color-primary-surface)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '1px 8px',
                  }}
                >
                  {activeGroupProducts.length}
                </span>
              )}
            </div>
            <Link
              href="/groupbuy"
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-primary)',
                fontWeight: 'var(--fw-bold)',
                textDecoration: 'none',
              }}
            >
              전체 보기 →
            </Link>
          </div>

          {groupLoading ? (
            <div style={{ display: 'flex', gap: 8 }}>
              {GROUP_SKELETON_KEYS.map((key) => (
                <Skeleton key={key} height={200} radius="md" style={{ flex: 1 }} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              {activeGroupProducts.slice(0, 3).map((product) => (
                <Link
                  key={product.id}
                  href={`/products/${product.id}`}
                  style={{ textDecoration: 'none', minWidth: 0, flex: 1 }}
                >
                  <Box
                    style={{
                      aspectRatio: '4/5',
                      borderRadius: 'var(--radius)',
                      overflow: 'hidden',
                      background: 'var(--color-border)',
                      marginBottom: 6,
                    }}
                  >
                    <Image
                      fill
                      src={product.images?.[0] ?? '/icons/icon-192x192.png'}
                      alt={product.name}
                      sizes="(max-width: 600px) 33vw, 140px"
                      style={{ objectFit: 'cover' }}
                    />
                  </Box>
                  <p
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: 'var(--fw-bold)',
                      color: 'var(--color-text)',
                      margin: '0 0 2px',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {product.name}
                  </p>
                  <p
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-primary)',
                      fontWeight: 'var(--fw-medium)',
                      margin: 0,
                    }}
                  >
                    {product.groupSummary
                      ? `${product.groupSummary.currentQuantity}/${product.groupSummary.targetQuantity}개`
                      : '모집 중'}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </Box>
      )}

      {!groupLoading && <DeadlineSection products={groupProducts} />}

      <HomeStorePreview />

      <Box>
        <Stack gap={4} mb="md">
          <Title order={4} style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>
            전체 상품
          </Title>
          <Divider />
        </Stack>

        {loading && (
          <SimpleGrid cols={2} spacing="sm">
            {PRODUCT_SKELETON_KEYS.map((key) => (
              <Skeleton key={key} height={260} radius="md" />
            ))}
          </SimpleGrid>
        )}

        {error && (
          <Stack align="center" py={48}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              {error}
            </span>
          </Stack>
        )}

        {!loading && !error && products.length === 0 && (
          <Stack align="center" py={48}>
            <span style={{ fontSize: 'var(--font-size-xl)' }}>🌱</span>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              등록된 상품이 없습니다.
            </span>
          </Stack>
        )}

        {!loading && products.length > 0 && (
          <SimpleGrid cols={2} spacing="sm">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </SimpleGrid>
        )}
      </Box>
    </>
  );
}
