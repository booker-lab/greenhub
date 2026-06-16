'use client';

import type { Product } from '@greenhub/shared';
import { Box, Divider, SimpleGrid, Skeleton, Stack, Title } from '@mantine/core';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import DeadlineSection from '@/components/DeadlineSection';
import HomeStorePreview from '@/components/HomeStorePreview';
import ProductCard from '@/components/ProductCard';
import { useProducts } from '@/hooks/useProducts';

const GROUP_PREVIEW_LIMIT = 3;
const GROUP_SKELETON_KEYS = ['group-skeleton-1', 'group-skeleton-2', 'group-skeleton-3'];
const PRODUCT_SKELETON_KEYS = [
  'home-product-skeleton-1',
  'home-product-skeleton-2',
  'home-product-skeleton-3',
  'home-product-skeleton-4',
];

function formatDeadlineLabel(deadline: string | undefined, now: number) {
  if (!deadline) return '모집 중';

  const diff = new Date(deadline).getTime() - now;
  if (!Number.isFinite(diff)) return '모집 중';
  if (diff <= 0) return '마감 확인 중';

  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `${minutes}분 남음`;

  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours}시간 남음`;

  return `${Math.ceil(hours / 24)}일 남음`;
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}

function getSafeQuantity(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(value ?? 0, 0) : 0;
}

function isActiveGroupProduct(product: Product) {
  const summary = product.groupSummary;
  if (!summary) return true;

  const targetQuantity = getSafeQuantity(summary.targetQuantity);
  if (targetQuantity <= 0) return true;

  return getSafeQuantity(summary.currentQuantity) < targetQuantity;
}

function GroupProductPreviewCard({ product, now }: { product: Product; now: number }) {
  const summary = product.groupSummary;
  const currentQuantity = getSafeQuantity(summary?.currentQuantity);
  const targetQuantity = getSafeQuantity(summary?.targetQuantity);
  const remainingQuantity = Math.max(targetQuantity - currentQuantity, 0);
  const deadlineLabel = formatDeadlineLabel(summary?.recruitDeadline, now);

  return (
    <Link
      href={`/products/${product.id}`}
      style={{
        textDecoration: 'none',
        minWidth: 0,
        flex: '1 1 0',
        display: 'block',
      }}
    >
      <Box
        style={{
          position: 'relative',
          display: 'block',
          width: '100%',
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
        <span
          style={{
            position: 'absolute',
            left: 6,
            bottom: 6,
            borderRadius: 'var(--radius-full)',
            background: 'rgba(17, 17, 17, 0.7)',
            color: 'var(--color-bg)',
            fontSize: 'var(--font-size-xs)',
            fontWeight: 'var(--fw-bold)',
            padding: '3px 8px',
          }}
        >
          {deadlineLabel}
        </span>
      </Box>
      <p
        style={{
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--fw-bold)',
          color: 'var(--color-text)',
          margin: '0 0 2px',
          minHeight: 38,
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
          overflowWrap: 'anywhere',
        }}
      >
        {targetQuantity > 0
          ? `${currentQuantity}/${targetQuantity}개 · ${remainingQuantity}개 더 필요`
          : '모집 중'}
      </p>
    </Link>
  );
}

export default function HomeProductList() {
  const now = useNow(60_000);
  const { products, loading, error } = useProducts();
  const { products: groupProducts, loading: groupLoading } = useProducts(
    undefined,
    undefined,
    'group',
  );

  const activeGroupProducts = useMemo(
    () => groupProducts.filter(isActiveGroupProduct),
    [groupProducts],
  );
  const visibleGroupProducts = activeGroupProducts.slice(0, GROUP_PREVIEW_LIMIT);

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
                진행 중 공동구매
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
              {visibleGroupProducts.map((product) => (
                <GroupProductPreviewCard key={product.id} product={product} now={now} />
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
