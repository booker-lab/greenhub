'use client';

import type { Product, SalesMode } from '@greenhub/shared';
import { getGroupBuyStatus, normalizeSalesMode } from '@greenhub/shared';
import { Box, Container, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core';
import { doc, getDoc } from 'firebase/firestore';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import ProductCard from '@/components/ProductCard';
import { useProducts } from '@/hooks/useProducts';
import { db } from '@/lib/firebase';

type StoreModeStatus = 'loading' | 'ready' | 'error';

interface StoreModeState {
  salesMode: SalesMode;
  status: StoreModeStatus;
}

function findSingleStoreId(products: Product[]) {
  const storeIds = new Set(
    products.map((product) => product.storeId).filter((storeId) => storeId.length > 0),
  );
  return storeIds.size === 1 ? [...storeIds][0] : null;
}

function useStoreMode(storeId: string | null, productsLoading: boolean): StoreModeState {
  const [state, setState] = useState<StoreModeState>({
    salesMode: 'legacy',
    status: 'loading',
  });

  useEffect(() => {
    if (productsLoading) {
      setState({ salesMode: 'legacy', status: 'loading' });
      return;
    }
    if (!storeId) {
      setState({ salesMode: 'legacy', status: 'ready' });
      return;
    }

    let active = true;
    setState({ salesMode: 'legacy', status: 'loading' });

    void getDoc(doc(db, 'stores', storeId))
      .then((snapshot) => {
        if (!active) return;
        if (!snapshot.exists()) throw new Error('스토어를 찾을 수 없습니다.');

        const value = snapshot.data()?.salesMode;
        if (value !== undefined && value !== 'legacy' && value !== 'round_direct') {
          throw new Error('판매 방식 정보가 올바르지 않습니다.');
        }
        setState({ salesMode: normalizeSalesMode(value), status: 'ready' });
      })
      .catch(() => {
        if (active) setState({ salesMode: 'legacy', status: 'error' });
      });

    return () => {
      active = false;
    };
  }, [productsLoading, storeId]);

  return state;
}
export default function GroupBuyPage() {
  const router = useRouter();
  const {
    products: discoveryProducts,
    loading: discoveryLoading,
    error: discoveryError,
  } = useProducts();
  const { products, loading, error } = useProducts(undefined, undefined, 'group');
  const storeId = useMemo(() => findSingleStoreId(discoveryProducts), [discoveryProducts]);
  const storeMode = useStoreMode(storeId, discoveryLoading);

  const { active, closed } = useMemo(() => {
    const active = [];
    const closed = [];
    const now = Date.now();
    for (const product of products) {
      if (getGroupBuyStatus(product.groupSummary, now) === 'open') active.push(product);
      else closed.push(product);
    }
    return { active, closed };
  }, [products]);

  useEffect(() => {
    if (storeMode.status === 'ready' && storeMode.salesMode === 'round_direct') {
      router.replace('/');
    }
  }, [router, storeMode.salesMode, storeMode.status]);

  if (discoveryError || storeMode.status === 'error') {
    return (
      <Container size="sm" px="md" pt="lg" pb={80}>
        <Stack align="center" py={48} role="alert">
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            판매 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </Text>
        </Stack>
      </Container>
    );
  }

  if (storeMode.status !== 'ready' || storeMode.salesMode === 'round_direct') {
    return (
      <Container
        size="sm"
        px="md"
        pt="lg"
        pb={80}
        aria-label={
          storeMode.salesMode === 'round_direct' ? '홈으로 이동 중' : '판매 정보 불러오는 중'
        }
      >
        <SimpleGrid cols={2} spacing="sm">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} height={260} radius="md" />
          ))}
        </SimpleGrid>
      </Container>
    );
  }

  return (
    <Container size="sm" px="md" pt="lg" pb={80}>
      {/* 히어로 배너 — 플랫 미니멀 */}
      <Box
        mb="xl"
        p="lg"
        style={{
          backgroundColor: 'var(--color-primary-surface)',
          borderRadius: 'var(--radius)',
          border: 'var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span
            style={{
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--fw-bold)',
              color: 'var(--color-primary)',
            }}
          >
            ⚡ 공동구매
          </span>
          <span
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--color-bg)',
              background: 'var(--color-primary)',
              borderRadius: 'var(--radius-sm)',
              padding: '1px 8px',
            }}
          >
            진행 중
          </span>
        </div>
        <p
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
            lineHeight: 1.6,
            margin: '0 0 8px',
          }}
        >
          함께 모이면 더 저렴하게! 목표 수량이 채워지면 주문이 확정됩니다.
        </p>
        <p
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-primary)',
            margin: 0,
            fontWeight: 'var(--fw-medium)',
          }}
        >
          현재 {loading ? '...' : `${active.length}개`} 공구 진행 중
        </p>
      </Box>

      {loading && (
        <SimpleGrid cols={2} spacing="sm">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} height={260} radius="md" />
          ))}
        </SimpleGrid>
      )}

      {!loading && error && (
        <Stack align="center" py={48}>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            {error}
          </Text>
        </Stack>
      )}

      {!loading && !error && active.length === 0 && closed.length === 0 && (
        <Stack align="center" py={64}>
          <Text size="xl">🌱</Text>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            진행 중인 공동구매가 없습니다.
          </Text>
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            <Link href="/" style={{ color: 'inherit' }}>
              전체 상품 보기
            </Link>
          </Text>
        </Stack>
      )}

      {!loading && active.length > 0 && (
        <Box mb="xl">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text)',
              }}
            >
              모집 중
            </span>
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
              {active.length}
            </span>
          </div>
          <SimpleGrid cols={2} spacing="sm">
            {active.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </SimpleGrid>
        </Box>
      )}

      {!loading && closed.length > 0 && (
        <Box>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span
              style={{
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-bold)',
                color: 'var(--color-text-disabled)',
              }}
            >
              모집 종료
            </span>
            <span
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--fw-medium)',
                color: 'var(--color-text-disabled)',
                background: 'var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 8px',
              }}
            >
              {closed.length}
            </span>
          </div>
          <SimpleGrid cols={2} spacing="sm" style={{ opacity: 0.6 }}>
            {closed.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </SimpleGrid>
        </Box>
      )}
    </Container>
  );
}
