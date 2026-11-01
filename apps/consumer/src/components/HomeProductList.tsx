'use client';

import type { Product, SaleRoundItem, SalesMode } from '@greenhub/shared';
import { getGroupBuyStatus, normalizeSalesMode } from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import BlockSkeleton from '@/components/BlockSkeleton';
import DeadlineSection from '@/components/DeadlineSection';
import ProductCard from '@/components/ProductCard';
import QuickAddToast, { type QuickAddToastState } from '@/components/QuickAddToast';
import ResilientImage, { PRODUCT_IMAGE_FALLBACK } from '@/components/ResilientImage';
import RoundCountdownStrip from '@/components/RoundCountdownStrip';
import { useCart } from '@/hooks/useCart';
import { useProducts } from '@/hooks/useProducts';
import { type PublicSaleRound, useSaleRounds } from '@/hooks/useSaleRounds';
import { captureAcquisition } from '@/lib/acquisition';
import {
  type StoreProfileFailure,
  classifyStoreProfileFailure,
  fetchPublicStoreProfile,
  storeProfileFailureMessage,
} from '@/lib/public-store-profile';
import { deliveryDayTag } from '@/lib/round-countdown';
import {
  canQuickAdd,
  cartAddFailureMessage,
  roundItemCartInput,
  roundProductHref,
} from '@/lib/round-quick-add';
import { fetchNeedsOptionChoice } from '@/lib/round-quick-add-options';
import {
  formatOrderCloseLabel,
  formatOrderOpenLabel,
  roundSectionTitle,
} from '@/lib/round-schedule-label';
import { homePrefetchStoreId, useHomeStorePrefetch } from './home-store-prefetch';
import { resolveHomeStoreId } from './home-store-selection';
import {
  BenchmarkCardProvider,
  CardDiscount,
  CardMeta,
  CardSellerLine,
  CardWishButton,
  type CardContextValue,
} from './benchmark/CardExtras';
import KakaoChannelCta from './benchmark/KakaoChannelCta';
import { useReviewStats, useRoundWishlist, useStoreProfile } from '@/hooks/useBenchmark';
import { isFeatureOn } from '@/lib/features';

type StoreModeStatus = 'loading' | 'ready' | StoreProfileFailure;

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
      .catch((error: unknown) => {
        if (active) {
          setState({ storeId, salesMode: 'legacy', status: classifyStoreProfileFailure(error) });
        }
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

// ① 외형 유지(UI 교체 P5): Mantine Box(div, component=Link면 a)·Stack(gap md 16·28·2·xl 32·4)·Group(gap md 16·8·
// xs 10)·SimpleGrid cols 2(gap sm 12, 가로 12·세로 20)·Skeleton(radius md 8)·Divider(gray-3 1px, hr = separator 역할)·
// Title order 2·4(줄 높이 1.35, 18px·1.45)·Text(p, 16px·1.55, size sm 15px·1.45, lineClamp)·Button light(sm·xs)와
// 같은 값. text-sm은 tokens.css에서 Mantine size sm과 같은 크기·줄 높이다. Mantine Button은 vertical-align: middle이라
// 블록 안에 놓인 버튼에는 align-middle을 준다.
const TEXT = 'm-0 p-0 text-[16px] leading-[1.55]';
const TEXT_SM = 'm-0 p-0 text-sm';
const LINE_CLAMP_2 = 'line-clamp-2 text-ellipsis';
const GRID = 'grid grid-cols-2 gap-3';
const ALERT_STACK = 'flex flex-col items-center justify-start gap-3 py-12';
const CENTER_STACK = 'flex flex-col items-center justify-start gap-4';
const DIVIDER = 'm-0 h-0 border-0 border-t border-solid border-[#dee2e6]';
const SECONDARY_COLOR = { color: 'var(--color-text-secondary)' } as const;
const DISABLED_COLOR = { color: 'var(--color-text-disabled)' } as const;

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
    <div style={{ position: 'relative', minWidth: 0 }}>
      <RoundProductCardLink
        href={href}
        item={item}
        round={round}
        isPast={isPast}
        tag={tag}
        dimmed={dimmed}
      />
      <div
        style={{
          aspectRatio: '1/1',
          left: 0,
          pointerEvents: 'none',
          position: 'absolute',
          top: 0,
          width: '100%',
        }}
      >
        <CardWishButton productId={item.productId} roundId={round.id} name={item.productNameSnapshot} />
      </div>
      {quickAdd && (
        // 사진과 같은 정사각형 영역 위에 + 버튼을 겹친다(링크 안에 버튼을 넣지 않기 위해 형제로 둔다).
        <div
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
        </div>
      )}
    </div>
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
    <Link
      href={href}
      aria-label={isPast ? `지난 회차 ${round.name} ${item.productNameSnapshot}` : undefined}
      style={{ display: 'block', minWidth: 0, color: 'inherit', textDecoration: 'none' }}
    >
      <div
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
      </div>
      <CardSellerLine />
      <p
        className={`${TEXT} ${LINE_CLAMP_2} ${isFeatureOn('seller-store') ? 'mt-0.5' : 'mt-2'}`}
        style={{
          color: 'var(--color-text)',
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--fw-bold)',
          lineHeight: 1.35,
        }}
      >
        {item.productNameSnapshot}
      </p>
      <p
        className={`${TEXT} mt-0.5`}
        style={{
          color: 'var(--color-text)',
          fontSize: 'var(--font-size-md)',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 'var(--fw-extrabold)',
        }}
      >
        {item.roundPrice.toLocaleString()}원
        <CardDiscount item={item} />
      </p>
      <CardMeta item={item} isPast={isPast} />
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
    </Link>
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
      <div className={`${CENTER_STACK} py-8`}>
        <p className={TEXT_SM} style={DISABLED_COLOR}>
          공개된 회차 상품이 없습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-5">
      {items.map((item) => (
        <RoundProductCard
          key={item.id}
          item={item}
          round={round}
          isPast={isPast}
          onQuickAdd={onQuickAdd}
        />
      ))}
    </div>
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
  storeId,
  card,
}: ReturnType<typeof useSaleRounds> & { storeId: string | null; card: CardContextValue }) {
  const { addItem } = useCart();
  const router = useRouter();
  const [toast, setToast] = useState<QuickAddToastState | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const handleQuickAdd = useCallback(
    (item: SaleRoundItem) => {
      void (async () => {
        // 옵션(화분 등)을 골라야 하는 상품은 담지 않고 상품 화면의 옵션 시트로 보낸다.
        if (await fetchNeedsOptionChoice(item.productId)) {
          router.push(roundProductHref(item));
          return;
        }
        const result = addItem(roundItemCartInput(item));
        setToast({
          id: Date.now(),
          tone: result.ok ? 'success' : 'error',
          message: result.ok ? '장바구니에 담았어요' : cartAddFailureMessage(result.reason),
        });
      })();
    },
    [addItem, router],
  );

  if (loading) {
    return (
      // biome-ignore lint/a11y/useAriaPropsSupportedByRole: 교체 전(Mantine Stack·SimpleGrid·Container)과 같은 div의 aria-label이다. 역할 변경은 ② 단계에서 다룬다.
      <div
        className="flex flex-col items-stretch justify-start gap-4"
        aria-label="판매 회차 불러오는 중"
      >
        <BlockSkeleton height={112} />
        <div className={GRID}>
          {[...Array(4)].map((_, index) => (
            <BlockSkeleton key={index} height={260} />
          ))}
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={ALERT_STACK} role="alert">
        <p className={TEXT_SM} style={SECONDARY_COLOR}>
          판매 회차를 불러오지 못했습니다.
        </p>
        {error && (
          <p className={TEXT_SM} style={DISABLED_COLOR}>
            {error}
          </p>
        )}
        <Button type="button" variant="light" onClick={refetch}>
          다시 시도
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch justify-start gap-7">
      {isRefreshing && (
        <p className={`${TEXT_SM} text-center`} style={SECONDARY_COLOR} aria-live="polite">
          최신 회차 정보를 확인하는 중...
        </p>
      )}
      {isStale && (
        <div
          className="p-4"
          role="alert"
          style={{
            background: 'var(--color-deadline-surface)',
            borderRadius: 'var(--radius)',
          }}
        >
          <p
            className={TEXT_SM}
            style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-deadline-text)' }}
          >
            최신 회차 정보를 불러오지 못했습니다. 이전 결과를 표시합니다.
          </p>
          {error && (
            <p className={`${TEXT_SM} mt-1`} style={SECONDARY_COLOR}>
              {error}
            </p>
          )}
          <Button
            type="button"
            variant="light"
            size="xs"
            className="mt-2.5 align-middle"
            onClick={refetch}
          >
            다시 시도
          </Button>
        </div>
      )}
      <section aria-labelledby="current-round-title">
        <div className="flex flex-row flex-nowrap items-baseline justify-between gap-2.5">
          <h2 id="current-round-title" className="m-0 leading-[1.35]" style={sectionTitleStyle}>
            {currentRound ? roundSectionTitle(currentRound.status) : '이번 주 판매'}
          </h2>
          {currentRound && (
            <p
              className={`${TEXT} text-right`}
              style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}
            >
              {currentRound.name}
              {currentRound.status === 'CLOSED' ? ' · 주문 마감' : ''}
            </p>
          )}
        </div>
        <div
          className="mt-3 mb-4 flex flex-col items-stretch justify-start gap-0.5 p-4"
          style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius)' }}
        >
          {currentRound?.status === 'SCHEDULED' && (
            <p
              className={TEXT_SM}
              style={{ fontWeight: 'var(--fw-extrabold)', color: 'var(--color-primary-dark)' }}
            >
              {formatOrderOpenLabel(currentRound.schedule.orderOpenAt)}
            </p>
          )}
          <p className={TEXT_SM} style={SECONDARY_COLOR}>
            주문 마감{' '}
            {currentRound
              ? formatOrderCloseLabel(currentRound.schedule.orderCloseAt)
              : '일정 준비 중'}
          </p>
          <p className={TEXT_SM} style={SECONDARY_COLOR}>
            경기도 이천시 직접배송
          </p>
          <p
            className={`${TEXT_SM} mt-1.5`}
            style={{ fontWeight: 'var(--fw-extrabold)', color: 'var(--color-primary-dark)' }}
          >
            화요일 오전 9시까지 문 앞 배송
          </p>
          {isFeatureOn('demand-signals') && currentRound?.demand && currentRound.demand.buyerCount > 0 && (
            <p
              className={`${TEXT_SM} mt-0.5`}
              style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}
            >
              이번 회차 {currentRound.demand.buyerCount}곳에서 주문했어요
            </p>
          )}
        </div>
        {isFeatureOn('open-alert') && currentRound?.status === 'SCHEDULED' && (
          <div className="mb-4">
            <KakaoChannelCta />
          </div>
        )}

        {currentRound ? (
          <RoundItems round={currentRound} onQuickAdd={handleQuickAdd} />
        ) : (
          <div className={`${CENTER_STACK} py-10`}>
            <p className={TEXT_SM} style={DISABLED_COLOR}>
              {isEmpty
                ? '준비된 판매 회차가 없습니다.'
                : '현재 판매 중이거나 예정된 회차가 없습니다.'}
            </p>
          </div>
        )}
      </section>

      {!(isFeatureOn('hide-empty-past') && pastRounds.length === 0) && (
      <>
      <div
        aria-hidden
        className="-mx-4"
        style={{ height: 8, background: 'var(--color-surface-muted)' }}
      />

      <section aria-labelledby="past-round-title">
        <h2 id="past-round-title" className="m-0 mb-4 leading-[1.35]" style={sectionTitleStyle}>
          지난 회차
        </h2>
        {pastRounds.length === 0 ? (
          <div className={`${CENTER_STACK} py-8`}>
            <p className={TEXT_SM} style={DISABLED_COLOR}>
              아직 지난 회차가 없습니다.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-stretch justify-start gap-8">
            {pastRounds.map((round) => (
              <div key={round.id}>
                <p
                  className={`${TEXT_SM} mb-2.5`}
                  style={{ color: 'var(--color-text-secondary)', fontWeight: 700 }}
                >
                  {round.name}
                </p>
                <RoundItems round={round} isPast />
              </div>
            ))}
          </div>
        )}
      </section>
      </>
      )}
      <QuickAddToast toast={toast} onClose={closeToast} />
    </div>
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
        <div className="mb-8">
          <div className="mb-3 flex flex-row flex-wrap items-center justify-between gap-4">
            <div className="flex flex-row flex-wrap items-center justify-start gap-2">
              <p className={TEXT_SM} style={{ fontWeight: 700, color: 'var(--color-text)' }}>
                ⚡ 진행 중 공동구매
              </p>
              {!groupLoading && (
                <p
                  className={`${TEXT_SM} px-2`}
                  style={{
                    fontWeight: 500,
                    color: 'var(--color-primary-dark)',
                    background: 'var(--color-primary-surface)',
                  }}
                >
                  {activeGroupProducts.length}
                </p>
              )}
            </div>
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
          </div>
          {groupLoading ? (
            <div style={{ display: 'flex', gap: 8 }}>
              {[...Array(3)].map((_, index) => (
                <BlockSkeleton key={index} height={200} style={{ flex: 1 }} />
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
                  <div
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
                  </div>
                  <p
                    className={`${TEXT_SM} ${LINE_CLAMP_2} mb-0.5`}
                    style={{ fontWeight: 700, color: 'var(--color-text)' }}
                  >
                    {product.name}
                  </p>
                  <p
                    className={TEXT_SM}
                    style={{ fontWeight: 500, color: 'var(--color-primary-dark)' }}
                  >
                    {product.groupSummary
                      ? `${product.groupSummary.currentQuantity}/${product.groupSummary.targetQuantity}개`
                      : '모집 중'}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
      {!groupLoading && <DeadlineSection products={groupProducts} />}
      <div>
        <div className="mb-4 flex flex-col items-stretch justify-start gap-1">
          <h4
            className="m-0 text-[18px] leading-[1.45]"
            style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-bold)' }}
          >
            전체 상품
          </h4>
          <hr className={DIVIDER} />
        </div>
        {loading && (
          <div className={GRID}>
            {[...Array(4)].map((_, index) => (
              <BlockSkeleton key={index} height={260} />
            ))}
          </div>
        )}
        {!loading && error && (
          <div className={ALERT_STACK} role="alert">
            <p className={TEXT_SM} style={DISABLED_COLOR}>
              {error}
            </p>
            <Button type="button" variant="light" onClick={refetch} data-testid="products-retry">
              다시 시도
            </Button>
          </div>
        )}
        {!loading && !error && products.length === 0 && (
          <div className={`${CENTER_STACK} py-12`}>
            <span style={{ fontSize: 'var(--font-size-xl)' }}>🌱</span>
            <p className={TEXT_SM} style={DISABLED_COLOR}>
              등록된 상품이 없습니다.
            </p>
          </div>
        )}
        {!loading && products.length > 0 && (
          <div className={GRID}>
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * 회차 카드의 벤치마킹 비교 기능(별점·할인율·판매자·찜 등)이 쓰는 상품 원본·통계.
 * wishRoundId: 이번 회차 찜을 붙일 회차(보통 지금 판매 중이거나 예정된 회차). 다른 회차 카드에는 찜이 없다.
 */
export function useHomeCardContext(
  storeId: string | null,
  products: Product[],
  wishRoundId: string | null = null,
): CardContextValue {
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const reviewStats = useReviewStats(storeId, isFeatureOn('reviews'));
  const storeProfile = useStoreProfile(
    storeId,
    isFeatureOn('seller-store') || isFeatureOn('quality-guarantee'),
  );
  const wishlist = useRoundWishlist(wishRoundId, isFeatureOn('wishlist'));
  return useMemo(
    () => ({
      productsById,
      reviewStats,
      storeProfile,
      wishlist:
        isFeatureOn('wishlist') && wishRoundId
          ? { roundId: wishRoundId, ids: wishlist.ids, toggle: wishlist.toggle }
          : undefined,
    }),
    [productsById, reviewStats, storeProfile, wishRoundId, wishlist.ids, wishlist.toggle],
  );
}

// 홈은 정적으로 만들어 CDN에 두므로 빌드 때는 주소 쿼리를 알 수 없다. 정적 HTML에는 storeId 없이 그린
// 첫 화면(배너·불러오는 중 표시)을 두고, 브라우저에서는 주소의 storeId로 다시 그린다.
export default function HomeProductList({ banner }: { banner?: ReactNode }) {
  return (
    <Suspense fallback={<HomeProductListBody banner={banner} requestedStoreId={null} />}>
      <HomeProductListWithQuery banner={banner} />
    </Suspense>
  );
}

function HomeProductListWithQuery({ banner }: { banner?: ReactNode }) {
  const requestedStoreId = useSearchParams().get('storeId');
  return <HomeProductListBody banner={banner} requestedStoreId={requestedStoreId} />;
}

function HomeProductListBody({
  banner,
  requestedStoreId,
}: {
  banner?: ReactNode;
  requestedStoreId: string | null;
}) {
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
  // 판매 방식 확인 → 회차 조회를 차례로 기다리지 않도록 매장을 알게 되는 즉시 둘을 함께 시작한다.
  // 아래 조회들은 같은 공유 요청을 받으므로 화면 판정 순서는 그대로다.
  useHomeStorePrefetch(homePrefetchStoreId(storeId, requestedStoreId));
  const storeMode = useStoreMode(storeId, loading || groupLoading);
  const saleRounds = useSaleRounds(
    storeMode.salesMode === 'round_direct' ? storeMode.storeId : null,
  );
  const isRoundDirect = storeMode.status === 'ready' && storeMode.salesMode === 'round_direct';
  const card = useHomeCardContext(
    isRoundDirect ? storeMode.storeId : null,
    products,
    saleRounds.currentRound?.id ?? null,
  );

  let content: ReactNode;
  if (storeMode.status === 'loading') {
    content = (
      // biome-ignore lint/a11y/useAriaPropsSupportedByRole: 교체 전(Mantine Stack·SimpleGrid·Container)과 같은 div의 aria-label이다. 역할 변경은 ② 단계에서 다룬다.
      <div className={GRID} aria-label="판매 정보 불러오는 중">
        {[...Array(4)].map((_, index) => (
          <BlockSkeleton key={index} height={260} />
        ))}
      </div>
    );
  } else if (storeMode.status !== 'ready') {
    content = (
      <div className={`${CENTER_STACK} py-12`} role="alert">
        <p className={TEXT_SM} style={SECONDARY_COLOR}>
          {storeProfileFailureMessage(storeMode.status)}
        </p>
      </div>
    );
  } else if (storeMode.salesMode === 'round_direct') {
    content = (
      <BenchmarkCardProvider value={card}>
        <RoundDirectHome {...saleRounds} storeId={storeMode.storeId} card={card} />
      </BenchmarkCardProvider>
    );
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
      <div className="px-4 pt-4">
        {banner}
        {content}
      </div>
    </>
  );
}
