'use client';

import type { Product, SaleRoundItem, SalesMode } from '@greenhub/shared';
import { normalizeSalesMode } from '@greenhub/shared';
import {
  Box,
  Button,
  Divider,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { doc, getDoc } from 'firebase/firestore';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import DeadlineSection from '@/components/DeadlineSection';
import ProductCard from '@/components/ProductCard';
import { useProducts } from '@/hooks/useProducts';
import { type PublicSaleRound, useSaleRounds } from '@/hooks/useSaleRounds';
import { captureAcquisition } from '@/lib/acquisition';
import { db } from '@/lib/firebase';
import { resolveHomeStoreId } from './home-store-selection';

type StoreModeStatus = 'loading' | 'ready' | 'error';

interface StoreModeState {
  storeId: string | null;
  salesMode: SalesMode;
  status: StoreModeStatus;
}

interface LegacyHomeProductListProps {
  products: Product[];
  loading: boolean;
  error: string | null;
  groupProducts: Product[];
  groupLoading: boolean;
}

function useStoreMode(storeId: string | null, productsLoading: boolean): StoreModeState {
  const [state, setState] = useState<StoreModeState>({
    storeId: null,
    salesMode: 'legacy',
    status: 'loading',
  });

  useEffect(() => {
    if (productsLoading) {
      setState({ storeId, salesMode: 'legacy', status: 'loading' });
      return;
    }
    if (!storeId) {
      setState({ storeId: null, salesMode: 'legacy', status: 'ready' });
      return;
    }

    let active = true;
    setState({ storeId, salesMode: 'legacy', status: 'loading' });

    void getDoc(doc(db, 'stores', storeId))
      .then((snapshot) => {
        if (!active) return;
        if (!snapshot.exists()) throw new Error('스토어를 찾을 수 없습니다.');

        const value = snapshot.data()?.salesMode;
        if (value !== undefined && value !== 'legacy' && value !== 'round_direct') {
          throw new Error('판매 방식 정보가 올바르지 않습니다.');
        }
        setState({
          storeId,
          salesMode: normalizeSalesMode(value),
          status: 'ready',
        });
      })
      .catch(() => {
        if (active) setState({ storeId, salesMode: 'legacy', status: 'error' });
      });

    return () => {
      active = false;
    };
  }, [productsLoading, storeId]);

  return state;
}

function formatDeadline(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '일정 확인 중';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function visibleItems(round: PublicSaleRound) {
  return [...round.items]
    .filter((item) => item.status !== 'HIDDEN')
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

function RoundProductCard({
  item,
  round,
  isPast = false,
}: {
  item: SaleRoundItem;
  round: PublicSaleRound;
  isPast?: boolean;
}) {
  const href = `/products/${encodeURIComponent(item.productId)}?round=${encodeURIComponent(round.id)}`;

  return (
    <Box
      component={Link}
      href={href}
      aria-label={isPast ? `지난 회차 ${round.name} ${item.productNameSnapshot}` : undefined}
      style={{
        display: 'block',
        overflow: 'hidden',
        color: 'inherit',
        textDecoration: 'none',
        border: 'var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <Box
        style={{
          position: 'relative',
          aspectRatio: '4/5',
          overflow: 'hidden',
          background: 'var(--color-border)',
        }}
      >
        <Image
          fill
          src={item.productImageUrlSnapshot ?? '/icons/icon-192x192.png'}
          alt={item.productNameSnapshot}
          sizes="(max-width: 600px) 50vw, 33vw"
          style={{ objectFit: 'cover' }}
        />
      </Box>
      <Box p="xs">
        <Text size="sm" fw={500} c="var(--color-text)" lineClamp={2}>
          {item.productNameSnapshot}
        </Text>
        <Text size="sm" fw={700} c="var(--color-text-secondary)" mt={4}>
          {item.roundPrice.toLocaleString()}원
        </Text>
      </Box>
    </Box>
  );
}

function RoundItems({ round, isPast = false }: { round: PublicSaleRound; isPast?: boolean }) {
  const items = visibleItems(round);
  if (items.length === 0) {
    return (
      <Stack align="center" py={32}>
        <Text size="sm" c="var(--color-text-disabled)">
          공개된 회차 상품이 없습니다.
        </Text>
      </Stack>
    );
  }

  return (
    <SimpleGrid cols={2} spacing="sm">
      {items.map((item) => (
        <RoundProductCard key={item.id} item={item} round={round} isPast={isPast} />
      ))}
    </SimpleGrid>
  );
}

function RoundDirectHome({
  currentRound,
  pastRounds,
  loading,
  error,
  isEmpty,
  refetch,
}: ReturnType<typeof useSaleRounds>) {
  if (loading) {
    return (
      <Stack gap="md" aria-label="판매 회차 불러오는 중">
        <Skeleton height={112} radius="md" />
        <SimpleGrid cols={2} spacing="sm">
          {[...Array(4)].map((_, index) => (
            <Skeleton key={index} height={260} radius="md" />
          ))}
        </SimpleGrid>
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack align="center" py={48} gap="sm" role="alert">
        <Text size="sm" c="var(--color-text-secondary)">
          판매 회차를 불러오지 못했습니다.
        </Text>
        <Button variant="light" onClick={refetch}>
          다시 시도
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap="xl">
      <Box component="section" aria-labelledby="current-round-title">
        <Stack gap={6} mb="md">
          <Title
            id="current-round-title"
            order={3}
            style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-bold)' }}
          >
            이번 주 판매
          </Title>
          <Text size="sm" c="var(--color-text-secondary)">
            주문 마감{' '}
            {currentRound ? formatDeadline(currentRound.schedule.orderCloseAt) : '일정 준비 중'}
          </Text>
          <Text size="sm" c="var(--color-text-secondary)">
            경기도 이천시 직접배송
          </Text>
          <Box
            mt={4}
            p="sm"
            style={{
              color: 'var(--color-primary)',
              background: 'var(--color-primary-surface)',
              borderRadius: 'var(--radius)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-bold)',
            }}
          >
            화요일 오전 9시까지 문 앞 배송
          </Box>
        </Stack>

        {currentRound ? (
          <>
            <Text mb={12} c="var(--color-text)" fw={700}>
              {currentRound.name}
              {currentRound.status === 'CLOSED' ? ' · 주문 마감' : ''}
            </Text>
            <RoundItems round={currentRound} />
          </>
        ) : (
          <Stack align="center" py={40}>
            <span style={{ fontSize: 'var(--font-size-xl)' }}>🌱</span>
            <Text size="sm" c="var(--color-text-disabled)">
              {isEmpty
                ? '준비된 판매 회차가 없습니다.'
                : '현재 판매 중이거나 예정된 회차가 없습니다.'}
            </Text>
          </Stack>
        )}
      </Box>

      <Divider />

      <Box component="section" aria-labelledby="past-round-title">
        <Title
          id="past-round-title"
          order={4}
          mb="md"
          style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-bold)' }}
        >
          지난 회차
        </Title>
        {pastRounds.length === 0 ? (
          <Stack align="center" py={32}>
            <Text size="sm" c="var(--color-text-disabled)">
              아직 지난 회차가 없습니다.
            </Text>
          </Stack>
        ) : (
          <Stack gap="xl">
            {pastRounds.map((round) => (
              <Box key={round.id}>
                <Text size="sm" c="var(--color-text-secondary)" fw={700} mb={10}>
                  {round.name}
                </Text>
                <RoundItems round={round} isPast />
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

function LegacyHomeProductList({
  products,
  loading,
  error,
  groupProducts,
  groupLoading,
}: LegacyHomeProductListProps) {
  const activeGroupProducts = groupProducts.filter(
    (product) =>
      !product.groupSummary ||
      product.groupSummary.currentQuantity < product.groupSummary.targetQuantity,
  );
  return (
    <>
      {(groupLoading || activeGroupProducts.length > 0) && (
        <Box mb="xl">
          <Group justify="space-between" mb={12}>
            <Group gap={8}>
              <Text size="sm" fw={700} c="var(--color-text)">
                ⚡ 진행 중 공동구매
              </Text>
              {!groupLoading && (
                <Text
                  size="sm"
                  fw={500}
                  c="var(--color-primary)"
                  bg="var(--color-primary-surface)"
                  px={8}
                >
                  {activeGroupProducts.length}
                </Text>
              )}
            </Group>
            <Link
              href="/groupbuy"
              style={{
                color: 'var(--color-primary)',
                textDecoration: 'none',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-bold)',
              }}
            >
              전체 보기 →
            </Link>
          </Group>
          {groupLoading ? (
            <div style={{ display: 'flex', gap: 8 }}>
              {[...Array(3)].map((_, index) => (
                <Skeleton key={index} height={200} radius="md" style={{ flex: 1 }} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              {activeGroupProducts.slice(0, 3).map((product) => (
                <Link
                  key={product.id}
                  href={`/products/${product.id}`}
                  style={{ minWidth: 0, flex: 1, textDecoration: 'none' }}
                >
                  <Box
                    style={{
                      aspectRatio: '4/5',
                      overflow: 'hidden',
                      background: 'var(--color-border)',
                      borderRadius: 'var(--radius)',
                      marginBottom: 6,
                    }}
                  >
                    {/* biome-ignore lint/performance/noImgElement: 기존 legacy 카드 동작을 보존한다. */}
                    <img
                      src={product.images?.[0] ?? '/icons/icon-192x192.png'}
                      alt={product.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </Box>
                  <Text size="sm" fw={700} c="var(--color-text)" lineClamp={2} mb={2}>
                    {product.name}
                  </Text>
                  <Text size="sm" fw={500} c="var(--color-primary)">
                    {product.groupSummary
                      ? `${product.groupSummary.currentQuantity}/${product.groupSummary.targetQuantity}개`
                      : '모집 중'}
                  </Text>
                </Link>
              ))}
            </div>
          )}
        </Box>
      )}
      {!groupLoading && <DeadlineSection products={groupProducts} />}
      <Box>
        <Stack gap={4} mb="md">
          <Title order={4} style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-bold)' }}>
            전체 상품
          </Title>
          <Divider />
        </Stack>
        {loading && (
          <SimpleGrid cols={2} spacing="sm">
            {[...Array(4)].map((_, index) => (
              <Skeleton key={index} height={260} radius="md" />
            ))}
          </SimpleGrid>
        )}
        {error && (
          <Stack align="center" py={48}>
            <Text size="sm" c="var(--color-text-disabled)">
              {error}
            </Text>
          </Stack>
        )}
        {!loading && !error && products.length === 0 && (
          <Stack align="center" py={48}>
            <span style={{ fontSize: 'var(--font-size-xl)' }}>🌱</span>
            <Text size="sm" c="var(--color-text-disabled)">
              등록된 상품이 없습니다.
            </Text>
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

export default function HomeProductList() {
  const requestedStoreId = useSearchParams().get('storeId');
  const { products, loading, error } = useProducts();
  const { products: groupProducts, loading: groupLoading } = useProducts(
    undefined,
    undefined,
    'group',
  );

  useEffect(() => {
    captureAcquisition();
  }, []);

  const storeId = useMemo(
    () => resolveHomeStoreId([...products, ...groupProducts], requestedStoreId),
    [groupProducts, products, requestedStoreId],
  );
  const storeMode = useStoreMode(storeId, loading || groupLoading);
  const saleRounds = useSaleRounds(
    storeMode.salesMode === 'round_direct' ? storeMode.storeId : null,
  );

  if (storeMode.status === 'loading') {
    return (
      <SimpleGrid cols={2} spacing="sm" aria-label="판매 정보 불러오는 중">
        {[...Array(4)].map((_, index) => (
          <Skeleton key={index} height={260} radius="md" />
        ))}
      </SimpleGrid>
    );
  }

  if (storeMode.status === 'error') {
    return (
      <Stack align="center" py={48} role="alert">
        <Text size="sm" c="var(--color-text-secondary)">
          판매 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </Text>
      </Stack>
    );
  }

  if (storeMode.salesMode === 'round_direct') {
    return <RoundDirectHome {...saleRounds} />;
  }

  return (
    <LegacyHomeProductList
      products={products}
      loading={loading}
      error={error}
      groupProducts={groupProducts}
      groupLoading={groupLoading}
    />
  );
}
