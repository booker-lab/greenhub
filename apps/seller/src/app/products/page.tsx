'use client';

import type { Product } from '@greenhub/shared';
import { Alert, AlertDescription, AlertTitle } from '@greenhub/ui/components/alert';
import { Button } from '@greenhub/ui/components/button';
import { Switch } from '@greenhub/ui/components/switch';
import { RefreshCcw } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { useStoreProducts } from '@/hooks/useStoreProducts';
import {
  resolveStoreProductsFilteredView,
  resolveStoreProductsView,
} from '@/hooks/useStoreProducts.recovery';
import { ApiError, apiJson } from '@/lib/api';
import { resolveProductDeleteFailure } from './_deleteResult';

type ProductFilter = 'all' | 'active' | 'inactive';

// ① 외형 유지(UI 교체 P2b): Mantine Text(p, 여백 0)·Paper(흰 바탕·모서리 16·그림자 xs·안쪽 16) 값.
const TEXT = 'm-0 p-0 text-base';

const CATEGORY_LABEL: Record<string, string> = {
  cut_flower: '절화',
  orchid: '난',
  foliage: '관엽',
};

export default function ProductsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const storeId = session?.user.storeId ?? null;
  const { products, loading, error, retry, hasLoaded, isStale } = useStoreProducts(storeId);
  const [filter, setFilter] = useState<ProductFilter>('all');

  const filtered = products.filter((p) => {
    if (filter === 'active') return p.isActive;
    if (filter === 'inactive') return !p.isActive;
    return true;
  });

  const view = resolveStoreProductsView({
    storeId,
    loading,
    error,
    productCount: products.length,
    hasLoaded,
  });
  const listView = resolveStoreProductsFilteredView(view, filtered.length);
  // 초기 로딩·첫 조회 실패 단계에서는 0건 카운트를 확정 수치처럼 노출하지 않는다.
  const countLabel = (count: number) => (hasLoaded && !error ? String(count) : '…');
  const activeCount = products.filter((p) => p.isActive).length;
  const inactiveCount = products.length - activeCount;

  return (
    <PageShell>
      <PageHeader
        title="상품 관리"
        right={
          <Button render={<Link href="/products/new" />} nativeButton={false} size="xs">
            + 등록
          </Button>
        }
      />

      {/* 필터 탭 */}
      <SegmentedTabs<ProductFilter>
        tabs={[
          { key: 'all', label: `전체 ${countLabel(products.length)}` },
          { key: 'active', label: `판매 중 ${countLabel(activeCount)}` },
          { key: 'inactive', label: `비활성 ${countLabel(inactiveCount)}` },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {/* 상품 목록 — error/empty/filter-empty 분리. 첫 조회 실패는 empty로 collapse하지 않는다. */}
      <div className="mx-auto max-w-[720px] p-4">
        <div className="flex flex-col gap-3">
          {!storeId && sessionStatus === 'loading' && <LoadingState />}

          {!storeId && sessionStatus !== 'loading' && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>스토어 정보를 확인할 수 없습니다</AlertTitle>
              <AlertDescription>
                로그인된 셀러 스토어 정보를 확인한 뒤 다시 시도해 주세요.
              </AlertDescription>
            </Alert>
          )}

          {!!storeId && listView === 'loading' && <LoadingState />}

          {!!storeId && listView === 'error' && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>상품을 불러오지 못했습니다</AlertTitle>
              <AlertDescription>
                <div className="flex flex-col gap-2.5">
                  <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
                    {error}
                  </p>
                  <Button size="xs" variant="light-destructive" onClick={retry}>
                    <RefreshCcw className="size-3.5" data-icon="inline-start" />
                    다시 조회
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {!!storeId && isStale && (
            <Alert variant="warning" role="alert">
              <AlertTitle>최신 상품 정보를 확인하지 못했습니다</AlertTitle>
              <AlertDescription>
                <div className="flex flex-col gap-2.5">
                  <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)' }}>
                    이전 목록을 표시합니다. 상태 변경·삭제는 서버 기준으로 처리되며 목록이 오래된
                    상태일 수 있습니다.
                  </p>
                  <Button size="xs" variant="light-warning" onClick={retry}>
                    <RefreshCcw className="size-3.5" data-icon="inline-start" />
                    다시 조회
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {!!storeId && listView === 'empty' && (
            <EmptyState
              icon={
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                  focusable="false"
                >
                  <rect x="2" y="7" width="20" height="14" rx="2" />
                  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                </svg>
              }
              text="등록된 상품이 없습니다"
              action={
                <Link
                  href="/products/new"
                  className="m-0 mt-2.5 p-0 text-base no-underline"
                  style={{
                    color: 'var(--color-primary-dark)',
                    fontWeight: 'var(--fw-medium)',
                    fontSize: 'var(--font-size-md)',
                  }}
                >
                  상품 등록하기 →
                </Link>
              }
            />
          )}

          {!!storeId && listView === 'filter-empty' && (
            <EmptyState text="조건에 맞는 상품이 없습니다" />
          )}

          {!!storeId &&
            (listView === 'list' || listView === 'stale') &&
            filtered.map((product) => (
              <ProductCard key={product.id} product={product} storeId={storeId} />
            ))}
        </div>
      </div>
    </PageShell>
  );
}

function ProductCard({ product, storeId }: { product: Product; storeId: string | null }) {
  const { data: session } = useSession();
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 주문·회차에 쓰여 지울 수 없는 상품 — 판매 중지 버튼으로 유도한다.
  const [inUse, setInUse] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleToggleActive() {
    if (!storeId) return;
    setToggling(true);
    setError(null);
    setInUse(false);
    try {
      await apiJson(
        `/stores/${storeId}/products/${product.id}/active`,
        session?.user.accessToken ?? '',
        { method: 'PATCH', body: JSON.stringify({ isActive: !product.isActive }) },
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '상품 상태 변경에 실패했습니다');
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    if (!storeId) return;
    setDeleting(true);
    setError(null);
    setInUse(false);
    try {
      await apiJson(`/stores/${storeId}/products/${product.id}`, session?.user.accessToken ?? '', {
        method: 'DELETE',
      });
      setConfirmOpen(false);
    } catch (e) {
      const failure = resolveProductDeleteFailure(e, product.isActive);
      setError(failure.message);
      setInUse(failure.inUse);
      // 지울 수 없는 상품이면 확인창을 닫아 카드의 안내와 판매 중지 버튼을 보이게 한다.
      if (failure.inUse) setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="block rounded-[16px] bg-white p-4 shadow-mantine-xs">
      <div className="flex flex-row flex-wrap items-start justify-start gap-3">
        {/* 이미지 */}
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 12,
            backgroundColor: 'var(--color-surface-muted)',
            flexShrink: 0,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          {product.images[0] ? (
            <Image
              fill
              src={product.images[0]}
              alt={product.name}
              sizes="64px"
              style={{ objectFit: 'cover' }}
            />
          ) : (
            <div style={{ color: 'var(--color-text-disabled)' }}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
                focusable="false"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
            </div>
          )}
        </div>

        {/* 정보 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex flex-row flex-nowrap items-center justify-between gap-2.5">
            <p
              className={`${TEXT} overflow-hidden text-ellipsis whitespace-nowrap`}
              style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }}
            >
              {product.name}
            </p>
            <Switch
              checked={product.isActive}
              onCheckedChange={() => void handleToggleActive()}
              disabled={toggling}
              aria-label={
                product.isActive ? '판매 중 — 클릭하여 비활성' : '비활성 — 클릭하여 판매 중으로'
              }
            />
          </div>
          <p
            className={`${TEXT} mt-0.5`}
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
          >
            {CATEGORY_LABEL[product.category]} · ₩{product.price.toLocaleString()}
            {product.saleType === 'group' && ' · 공동구매'}
          </p>
          {error && (
            <p
              className={`${TEXT} mt-1`}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
            >
              {error}
            </p>
          )}
          <div className="mt-2.5 flex flex-row flex-wrap items-center justify-start gap-2.5">
            <Button
              render={<Link href={`/products/${product.id}/edit`} />}
              nativeButton={false}
              size="xs"
              variant="ghost"
            >
              수정
            </Button>
            {inUse && product.isActive && (
              <Button
                size="xs"
                variant="light"
                onClick={handleToggleActive}
                disabled={toggling}
                aria-busy={toggling}
              >
                판매 중지
              </Button>
            )}
            <Button
              size="xs"
              variant="subtle-destructive"
              onClick={() => setConfirmOpen(true)}
              disabled={deleting}
              aria-busy={deleting}
            >
              삭제
            </Button>
          </div>
        </div>
      </div>

      <ConfirmModal
        opened={confirmOpen}
        title="상품 삭제"
        message={`"${product.name}" 상품을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다. 주문·회차에 쓰인 상품은 지울 수 없어요.`}
        confirmLabel="삭제"
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => {
          if (!deleting) setConfirmOpen(false);
        }}
      />
    </div>
  );
}
