'use client';

import type { Product, SaleRoundItem, SalesMode } from '@greenhub/shared';
import { getGroupBuyStatus, normalizeSalesMode } from '@greenhub/shared';
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
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import DeadlineSection from '@/components/DeadlineSection';
import ProductCard from '@/components/ProductCard';
import QuickAddToast, { type QuickAddToastState } from '@/components/QuickAddToast';
import ResilientImage, { PRODUCT_IMAGE_FALLBACK } from '@/components/ResilientImage';
import RoundCountdownStrip from '@/components/RoundCountdownStrip';
import { useCart } from '@/hooks/useCart';
import { useProducts } from '@/hooks/useProducts';
import { type PublicSaleRound, useSaleRounds } from '@/hooks/useSaleRounds';
import { captureAcquisition } from '@/lib/acquisition';
import { fetchPublicStoreProfile } from '@/lib/public-store-profile';
import { deliveryDayTag } from '@/lib/round-countdown';
import { canQuickAdd, cartAddFailureMessage, roundItemCartInput } from '@/lib/round-quick-add';
import {
  formatOrderCloseLabel,
  formatOrderOpenLabel,
  roundSectionTitle,
} from '@/lib/round-schedule-label';
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
  refetch: () => void;
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

    void fetchPublicStoreProfile(storeId)
      .then((profile) => {
        if (!active) return;
        const value = profile.salesMode;
        if (value !== 'legacy' && value !== 'round_direct') {
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

function visibleItems(round: PublicSaleRound) {
  return [...round.items]
    .filter((item) => item.status !== 'HIDDEN')
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

type TagTone = 'primary' | 'deadline' | 'muted';

const TAG_TONE: Record<TagTone, { background: string; color: string }> = {
  primary: { background: 'var(--color-primary-surface)', color: 'var(--color-primary-dark)' },
  deadline: { background: 'var(--color-deadline-surface)', color: 'var(--color-deadline-text)' },
  muted: { background: 'var(--color-surface-muted)', color: 'var(--color-text-secondary)' },
};

// 남은 수량은 공개 API가 숨기는 재고 신호라 표시하지 않는다(품절만 표시).
function roundItemTag(
  item: SaleRoundItem,
  round: PublicSaleRound,
  isPast: boolean,
): { label: string; tone: TagTone } | null {
  if (isPast) return null;
  if (item.status === 'SOLD_OUT') return { label: '품절', tone: 'muted' };
  if (round.status === 'SCHEDULED') return { label: '판매 예정', tone: 'deadline' };
  if (round.status !== 'OPEN' || item.status === 'CLOSED') {
    return { label: '판매 종료', tone: 'muted' };
  }
  const arrival = deliveryDayTag(round.schedule.deliveryStartAt);
  return arrival ? { label: arrival, tone: 'primary' } : null;
}

function RoundProductCard({
  item,
  round,
  isPast = false,
  onQuickAdd,
}: {
  item: SaleRoundItem;
  round: PublicSaleRound;
  isPast?: boolean;
  onQuickAdd?: (item: SaleRoundItem) => void;
}) {
  const href = `/products/${encodeURIComponent(item.productId)}?round=${encodeURIComponent(round.id)}`;
  const tag = roundItemTag(item, round, isPast);
  const dimmed = isPast || item.status === 'SOLD_OUT';
  const quickAdd = onQuickAdd && canQuickAdd(item, round.status, isPast) ? onQuickAdd : null;

  return (
    <Box style={{ position: 'relative', minWidth: 0 }}>
      <RoundProductCardLink
        href={href}
        item={item}
        round={round}
        isPast={isPast}
        tag={tag}
        dimmed={dimmed}
      />
      {quickAdd && (
        // 사진과 같은 정사각형 영역 위에 + 버튼을 겹친다(링크 안에 버튼을 넣지 않기 위해 형제로 둔다).
        <Box
          style={{
            aspectRatio: '1/1',
            left: 0,
            pointerEvents: 'none',
            position: 'absolute',
            top: 0,
            width: '100%',
          }}
        >
          <button
            type="button"
            aria-label={`${item.productNameSnapshot} 장바구니에 담기`}
            onClick={() => quickAdd(item)}
            style={{
              alignItems: 'center',
              background: 'transparent',
              border: 0,
              bottom: 2,
              cursor: 'pointer',
              display: 'flex',
              height: 'var(--touch-target)',
              justifyContent: 'center',
              padding: 0,
              pointerEvents: 'auto',
              position: 'absolute',
              right: 2,
              width: 'var(--touch-target)',
            }}
          >
            <span
              aria-hidden
              style={{
                alignItems: 'center',
                background: 'var(--color-bg)',
                borderRadius: 'var(--radius-full)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                color: 'var(--color-primary-dark)',
                display: 'flex',
                fontSize: 22,
                fontWeight: 'var(--fw-extrabold)',
                height: 34,
                justifyContent: 'center',
                lineHeight: 1,
                width: 34,
              }}
            >
              +
            </span>
          </button>
        </Box>
      )}
    </Box>
  );
}

function RoundProductCardLink({
  href,
  item,
  round,
  isPast,
  tag,
  dimmed,
}: {
  href: string;
  item: SaleRoundItem;
  round: PublicSaleRound;
  isPast: boolean;
  tag: ReturnType<typeof roundItemTag>;
  dimmed: boolean;
}) {
  return (
    <Box
      component={Link}
      href={href}
      aria-label={isPast ? `지난 회차 ${round.name} ${item.productNameSnapshot}` : undefined}
      style={{ display: 'block', minWidth: 0, color: 'inherit', textDecoration: 'none' }}
    >
      <Box
        style={{
          position: 'relative',
          aspectRatio: '1/1',
          overflow: 'hidden',
          borderRadius: 'var(--radius)',
          background: 'var(--color-surface-muted)',
          opacity: dimmed ? 0.6 : 1,
        }}
      >
        <ResilientImage
          fill
          src={item.productImageUrlSnapshot ?? PRODUCT_IMAGE_FALLBACK}
          fallbackSrc={PRODUCT_IMAGE_FALLBACK}
          alt={item.productNameSnapshot}
          sizes="(max-width: 600px) 50vw, 33vw"
          style={{ objectFit: 'cover' }}
        />
      </Box>
      <Text
        mt={8}
        lineClamp={2}
        style={{
          color: 'var(--color-text)',
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--fw-bold)',
          lineHeight: 1.35,
        }}
      >
        {item.productNameSnapshot}
      </Text>
      <Text
        mt={2}
        style={{
          color: 'var(--color-text)',
          fontSize: 'var(--font-size-md)',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 'var(--fw-extrabold)',
        }}
      >
        {item.roundPrice.toLocaleString()}원
      </Text>
      {tag && (
        <span
          style={{
            ...TAG_TONE[tag.tone],
            borderRadius: 'var(--radius-tag)',
            display: 'inline-block',
            fontSize: 'var(--font-size-xs)',
            fontWeight: 'var(--fw-bold)',
            marginTop: 6,
            padding: '2px 7px',
          }}
        >
          {tag.label}
        </span>
      )}
    </Box>
  );
}

function RoundItems({
  round,
  isPast = false,
  onQuickAdd,
}: {
  round: PublicSaleRound;
  isPast?: boolean;
  onQuickAdd?: (item: SaleRoundItem) => void;
}) {
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
    <SimpleGrid cols={2} spacing={12} verticalSpacing={20}>
      {items.map((item) => (
        <RoundProductCard
          key={item.id}
          item={item}
          round={round}
          isPast={isPast}
          onQuickAdd={onQuickAdd}
        />
      ))}
    </SimpleGrid>
  );
}

const sectionTitleStyle = {
  color: 'var(--color-text)',
  fontSize: 'var(--font-size-lg)',
  fontWeight: 'var(--fw-extrabold)',
  letterSpacing: '-0.01em',
} as const;

function RoundDirectHome({
  currentRound,
  pastRounds,
  loading,
  error,
  isEmpty,
  isRefreshing,
  isStale,
  status,
  refetch,
}: ReturnType<typeof useSaleRounds>) {
  const { addItem } = useCart();
  const [toast, setToast] = useState<QuickAddToastState | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const handleQuickAdd = useCallback(
    (item: SaleRoundItem) => {
      const result = addItem(roundItemCartInput(item));
      setToast({
        id: Date.now(),
        tone: result.ok ? 'success' : 'error',
        message: result.ok ? '장바구니에 담았어요' : cartAddFailureMessage(result.reason),
      });
    },
    [addItem],
  );

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

  if (status === 'error') {
    return (
      <Stack align="center" py={48} gap="sm" role="alert">
        <Text size="sm" c="var(--color-text-secondary)">
          판매 회차를 불러오지 못했습니다.
        </Text>
        {error && (
          <Text size="sm" c="var(--color-text-disabled)">
            {error}
          </Text>
        )}
        <Button variant="light" onClick={refetch}>
          다시 시도
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap={28}>
      {isRefreshing && (
        <Text size="sm" c="var(--color-text-secondary)" ta="center" aria-live="polite">
          최신 회차 정보를 확인하는 중...
        </Text>
      )}
      {isStale && (
        <Box
          p="md"
          role="alert"
          style={{
            background: 'var(--color-deadline-surface)',
            borderRadius: 'var(--radius)',
          }}
        >
          <Text size="sm" fw="var(--fw-bold)" c="var(--color-deadline-text)">
            최신 회차 정보를 불러오지 못했습니다. 이전 결과를 표시합니다.
          </Text>
          {error && (
            <Text size="sm" c="var(--color-text-secondary)" mt={4}>
              {error}
            </Text>
          )}
          <Button variant="light" size="xs" mt="xs" onClick={refetch}>
            다시 시도
          </Button>
        </Box>
      )}
      <Box component="section" aria-labelledby="current-round-title">
        <Group justify="space-between" align="baseline" gap="xs" wrap="nowrap">
          <Title id="current-round-title" order={2} style={sectionTitleStyle}>
            {currentRound ? roundSectionTitle(currentRound.status) : '이번 주 판매'}
          </Title>
          {currentRound && (
            <Text
              ta="right"
              style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}
            >
              {currentRound.name}
              {currentRound.status === 'CLOSED' ? ' · 주문 마감' : ''}
            </Text>
          )}
        </Group>
        <Stack
          gap={2}
          mt="sm"
          mb="md"
          p="md"
          style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius)' }}
        >
          {currentRound?.status === 'SCHEDULED' && (
            <Text size="sm" fw="var(--fw-extrabold)" c="var(--color-primary-dark)">
              {formatOrderOpenLabel(currentRound.schedule.orderOpenAt)}
            </Text>
          )}
          <Text size="sm" c="var(--color-text-secondary)">
            주문 마감{' '}
            {currentRound
              ? formatOrderCloseLabel(currentRound.schedule.orderCloseAt)
              : '일정 준비 중'}
          </Text>
          <Text size="sm" c="var(--color-text-secondary)">
            경기도 이천시 직접배송
          </Text>
          <Text mt={6} size="sm" fw="var(--fw-extrabold)" c="var(--color-primary-dark)">
            화요일 오전 9시까지 문 앞 배송
          </Text>
        </Stack>

        {currentRound ? (
          <RoundItems round={currentRound} onQuickAdd={handleQuickAdd} />
        ) : (
          <Stack align="center" py={40}>
            <Text size="sm" c="var(--color-text-disabled)">
              {isEmpty
                ? '준비된 판매 회차가 없습니다.'
                : '현재 판매 중이거나 예정된 회차가 없습니다.'}
            </Text>
          </Stack>
        )}
      </Box>

      <Box aria-hidden mx={-16} style={{ height: 8, background: 'var(--color-surface-muted)' }} />

      <Box component="section" aria-labelledby="past-round-title">
        <Title id="past-round-title" order={2} mb="md" style={sectionTitleStyle}>
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
      <QuickAddToast toast={toast} onClose={closeToast} />
    </Stack>
  );
}

function LegacyHomeProductList({
  products,
  loading,
  error,
  refetch,
  groupProducts,
  groupLoading,
}: LegacyHomeProductListProps) {
  const activeGroupProducts = groupProducts.filter(
    (product) => getGroupBuyStatus(product.groupSummary) === 'open',
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
                  c="var(--color-primary-dark)"
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
                color: 'var(--color-primary-dark)',
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
                      position: 'relative',
                    }}
                  >
                    <ResilientImage
                      fill
                      src={product.images?.[0] ?? PRODUCT_IMAGE_FALLBACK}
                      fallbackSrc={PRODUCT_IMAGE_FALLBACK}
                      alt={product.name}
                      sizes="(max-width: 600px) 33vw, 200px"
                      style={{ objectFit: 'cover' }}
                    />
                  </Box>
                  <Text size="sm" fw={700} c="var(--color-text)" lineClamp={2} mb={2}>
                    {product.name}
                  </Text>
                  <Text size="sm" fw={500} c="var(--color-primary-dark)">
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
        {!loading && error && (
          <Stack align="center" py={48} gap="sm" role="alert">
            <Text size="sm" c="var(--color-text-disabled)">
              {error}
            </Text>
            <Button variant="light" onClick={refetch} data-testid="products-retry">
              다시 시도
            </Button>
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

export default function HomeProductList({ banner }: { banner?: ReactNode }) {
  const requestedStoreId = useSearchParams().get('storeId');
  const { products, loading, error, refetch } = useProducts();
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
  const isRoundDirect = storeMode.status === 'ready' && storeMode.salesMode === 'round_direct';

  let content: ReactNode;
  if (storeMode.status === 'loading') {
    content = (
      <SimpleGrid cols={2} spacing={12} aria-label="판매 정보 불러오는 중">
        {[...Array(4)].map((_, index) => (
          <Skeleton key={index} height={260} radius="md" />
        ))}
      </SimpleGrid>
    );
  } else if (storeMode.status === 'error') {
    content = (
      <Stack align="center" py={48} role="alert">
        <Text size="sm" c="var(--color-text-secondary)">
          판매 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </Text>
      </Stack>
    );
  } else if (storeMode.salesMode === 'round_direct') {
    content = <RoundDirectHome {...saleRounds} />;
  } else {
    content = (
      <LegacyHomeProductList
        products={products}
        loading={loading}
        error={error}
        refetch={refetch}
        groupProducts={groupProducts}
        groupLoading={groupLoading}
      />
    );
  }

  return (
    <>
      {isRoundDirect && saleRounds.currentRound && (
        <RoundCountdownStrip
          status={saleRounds.currentRound.status}
          schedule={saleRounds.currentRound.schedule}
        />
      )}
      <Box px="md" pt="md">
        {banner}
        {content}
      </Box>
    </>
  );
}
