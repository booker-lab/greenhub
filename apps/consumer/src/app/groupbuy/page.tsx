'use client';

import type { Product, SalesMode } from '@greenhub/shared';
import { getGroupBuyStatus, normalizeSalesMode } from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import BlockSkeleton from '@/components/BlockSkeleton';
import ProductCard from '@/components/ProductCard';
import { useProducts } from '@/hooks/useProducts';
import {
  classifyStoreProfileFailure,
  fetchPublicStoreProfile,
  type StoreProfileFailure,
  storeProfileFailureMessage,
} from '@/lib/public-store-profile';

// ① 외형 유지(UI 교체 P5): Mantine Container size sm(720px·좌우 md 16·위 lg 20·아래 80)·Stack(gap md 16·sm 12)·
// SimpleGrid cols 2(gap sm 12)·Skeleton(높이 260, radius md 8)·Box(mb xl 32·p lg 20)·Text(p, 16px·줄 높이 1.55,
// size xl은 20px·1.65)·Button light(sm)와 같은 값.
const CONTAINER = 'mx-auto max-w-[720px] px-4 pt-5 pb-20';
const TEXT = 'm-0 p-0 text-[16px] leading-[1.55]';
const ALERT_STACK = 'flex flex-col items-center justify-start gap-3 py-12';
const EMPTY_STACK = 'flex flex-col items-center justify-start gap-4 py-16';
const GRID = 'grid grid-cols-2 gap-3';
const DISABLED_TEXT_STYLE = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-disabled)',
} as const;

type StoreModeStatus = 'loading' | 'ready' | StoreProfileFailure;

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

    void fetchPublicStoreProfile(storeId)
      .then((profile) => {
        if (!active) return;
        const value = profile.salesMode;
        if (value !== 'legacy' && value !== 'round_direct') {
          throw new Error('판매 방식 정보가 올바르지 않습니다.');
        }
        setState({ salesMode: normalizeSalesMode(value), status: 'ready' });
      })
      .catch((error: unknown) => {
        if (active) setState({ salesMode: 'legacy', status: classifyStoreProfileFailure(error) });
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
    refetch: refetchDiscovery,
  } = useProducts();
  const { products, loading, error, refetch } = useProducts(undefined, undefined, 'group');
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

  const storeFailure =
    storeMode.status === 'error' || storeMode.status === 'unavailable' ? storeMode.status : null;
  if (discoveryError || storeFailure) {
    return (
      <div className={CONTAINER}>
        <div className={ALERT_STACK} role="alert">
          <p className={TEXT} style={DISABLED_TEXT_STYLE}>
            {storeProfileFailureMessage(!discoveryError && storeFailure ? storeFailure : 'error')}
          </p>
          {discoveryError && (
            <Button
              type="button"
              variant="light"
              onClick={refetchDiscovery}
              data-testid="products-retry"
            >
              다시 시도
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (storeMode.status !== 'ready' || storeMode.salesMode === 'round_direct') {
    return (
      // biome-ignore lint/a11y/useAriaPropsSupportedByRole: 교체 전(Mantine Stack·SimpleGrid·Container)과 같은 div의 aria-label이다. 역할 변경은 ② 단계에서 다룬다.
      <div
        className={CONTAINER}
        aria-label={
          storeMode.salesMode === 'round_direct' ? '홈으로 이동 중' : '판매 정보 불러오는 중'
        }
      >
        <div className={GRID}>
          {[...Array(4)].map((_, i) => (
            <BlockSkeleton key={i} height={260} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={CONTAINER}>
      {/* 히어로 배너 — 플랫 미니멀 */}
      <div
        className="mb-8 p-5"
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
              color: 'var(--color-primary-dark)',
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
            color: 'var(--color-primary-dark)',
            margin: 0,
            fontWeight: 'var(--fw-medium)',
          }}
        >
          현재 {loading ? '...' : `${active.length}개`} 공구 진행 중
        </p>
      </div>

      {loading && (
        <div className={GRID}>
          {[...Array(4)].map((_, i) => (
            <BlockSkeleton key={i} height={260} />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className={ALERT_STACK} role="alert">
          <p className={TEXT} style={DISABLED_TEXT_STYLE}>
            {error}
          </p>
          <Button type="button" variant="light" onClick={refetch} data-testid="products-retry">
            다시 시도
          </Button>
        </div>
      )}

      {!loading && !error && active.length === 0 && closed.length === 0 && (
        <div className={EMPTY_STACK}>
          <p className="m-0 p-0 text-[20px] leading-[1.65]">🌱</p>
          <p className={TEXT} style={DISABLED_TEXT_STYLE}>
            진행 중인 공동구매가 없습니다.
          </p>
          <p className={TEXT} style={DISABLED_TEXT_STYLE}>
            <Link href="/" style={{ color: 'inherit' }}>
              전체 상품 보기
            </Link>
          </p>
        </div>
      )}

      {!loading && active.length > 0 && (
        <div className="mb-8">
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
                color: 'var(--color-primary-dark)',
                background: 'var(--color-primary-surface)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 8px',
              }}
            >
              {active.length}
            </span>
          </div>
          <div className={GRID}>
            {active.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </div>
      )}

      {!loading && closed.length > 0 && (
        <div>
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
          <div className={GRID} style={{ opacity: 0.6 }}>
            {closed.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
