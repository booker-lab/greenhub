'use client';

import type { Product } from '@greenhub/shared';
import { Alert, Box, Button, Container, Group, Paper, Stack, Switch, Text } from '@mantine/core';
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

type ProductFilter = 'all' | 'active' | 'inactive';

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
          <Button
            component={Link}
            href="/products/new"
            size="xs"
            radius="md"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
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
      <Container size="sm" px="md" py="md">
        <Stack gap="sm">
          {!storeId && sessionStatus === 'loading' && <LoadingState />}

          {!storeId && sessionStatus !== 'loading' && (
            <Alert color="red" title="스토어 정보를 확인할 수 없습니다" role="alert">
              로그인된 셀러 스토어 정보를 확인한 뒤 다시 시도해 주세요.
            </Alert>
          )}

          {!!storeId && listView === 'loading' && <LoadingState />}

          {!!storeId && listView === 'error' && (
            <Alert
              color="red"
              title="상품을 불러오지 못했습니다"
              role="alert"
            >
              <Stack gap="xs">
                <Text style={{ fontSize: 'var(--font-size-sm)' }}>{error}</Text>
                <Button
                  size="xs"
                  variant="light"
                  color="red"
                  leftSection={<RefreshCcw size={14} />}
                  onClick={retry}
                >
                  다시 조회
                </Button>
              </Stack>
            </Alert>
          )}

          {!!storeId && isStale && (
            <Alert
              color="yellow"
              title="최신 상품 정보를 확인하지 못했습니다"
              role="alert"
            >
              <Stack gap="xs">
                <Text style={{ fontSize: 'var(--font-size-sm)' }}>
                  이전 목록을 표시합니다. 상태 변경·삭제는 서버 기준으로 처리되며 목록이
                  오래된 상태일 수 있습니다.
                </Text>
                <Button
                  size="xs"
                  variant="light"
                  color="yellow"
                  leftSection={<RefreshCcw size={14} />}
                  onClick={retry}
                >
                  다시 조회
                </Button>
              </Stack>
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
                <Text
                  component={Link}
                  href="/products/new"
                  mt="xs"
                  style={{
                    color: 'var(--color-primary)',
                    fontWeight: 'var(--fw-medium)',
                    fontSize: 'var(--font-size-md)',
                  }}
                >
                  상품 등록하기 →
                </Text>
              }
            />
          )}

          {!!storeId && listView === 'filter-empty' && (
            <EmptyState text="조건에 맞는 상품이 없습니다" />
          )}

          {!!storeId && (listView === 'list' || listView === 'stale') && (
            filtered.map((product) => (
              <ProductCard key={product.id} product={product} storeId={storeId} />
            ))
          )}
        </Stack>
      </Container>
    </PageShell>
  );
}

function ProductCard({ product, storeId }: { product: Product; storeId: string | null }) {
  const { data: session } = useSession();
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleToggleActive() {
    if (!storeId) return;
    setToggling(true);
    setError(null);
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
    try {
      await apiJson(`/stores/${storeId}/products/${product.id}`, session?.user.accessToken ?? '', {
        method: 'DELETE',
      });
      setConfirmOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '상품 삭제에 실패했습니다');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Paper radius="lg" shadow="xs" p="md">
      <Group gap="sm" align="flex-start">
        {/* 이미지 */}
        <Box
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
            <Box style={{ color: 'var(--color-text-disabled)' }}>
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
            </Box>
          )}
        </Box>

        {/* 정보 */}
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" justify="space-between" wrap="nowrap" align="center">
            <Text
              style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-sm)' }}
              truncate
            >
              {product.name}
            </Text>
            <Switch
              checked={product.isActive}
              onChange={handleToggleActive}
              disabled={toggling}
              size="sm"
              color="green"
              aria-label={
                product.isActive ? '판매 중 — 클릭하여 비활성' : '비활성 — 클릭하여 판매 중으로'
              }
            />
          </Group>
          <Text
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            mt={2}
          >
            {CATEGORY_LABEL[product.category]} · ₩{product.price.toLocaleString()}
            {product.saleType === 'group' && ' · 공동구매'}
          </Text>
          {error && (
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }} mt={4}>
              {error}
            </Text>
          )}
          <Group gap="xs" mt="xs">
            <Button
              component={Link}
              href={`/products/${product.id}/edit`}
              size="xs"
              variant="subtle"
              color="gray"
            >
              수정
            </Button>
            <Button
              size="xs"
              variant="subtle"
              color="red"
              onClick={() => setConfirmOpen(true)}
              loading={deleting}
            >
              삭제
            </Button>
          </Group>
        </Box>
      </Group>

      <ConfirmModal
        opened={confirmOpen}
        title="상품 삭제"
        message={`"${product.name}" 상품을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`}
        confirmLabel="삭제"
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => {
          if (!deleting) setConfirmOpen(false);
        }}
      />
    </Paper>
  );
}
