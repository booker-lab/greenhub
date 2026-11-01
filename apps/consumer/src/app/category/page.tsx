'use client';

import type { Category, ColorOption, Product, SaleRoundItem, SaleType, SalesMode } from '@greenhub/shared';
import { normalizeSalesMode } from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import BlockSkeleton from '@/components/BlockSkeleton';
import ProductCard from '@/components/ProductCard';
import { useProducts } from '@/hooks/useProducts';
import { type PublicSaleRound, useSaleRounds } from '@/hooks/useSaleRounds';
import {
  type StoreProfileFailure,
  classifyStoreProfileFailure,
  fetchPublicStoreProfile,
  storeProfileFailureMessage,
} from '@/lib/public-store-profile';
import { CardDiscount, CardMeta, CardSellerLine, BenchmarkCardProvider } from '@/components/benchmark/CardExtras';
import ProductRequestBox from '@/components/benchmark/ProductRequestBox';
import { useHomeCardContext } from '@/components/HomeProductList';
import { isFeatureOn } from '@/lib/features';

const TABS: { label: string; value: Category | undefined; saleType?: SaleType }[] = [
  { label: '전체', value: undefined },
  { label: '공동구매', value: undefined, saleType: 'group' },
  { label: '절화', value: 'cut_flower' },
  { label: '난', value: 'orchid' },
  { label: '관엽', value: 'foliage' },
];

// 꽃 색상 데이터 — hex 유지 필수 (브랜드 컬러 예외)
const COLOR_CHIPS: { label: string; value: ColorOption; hex: string }[] = [
  { label: '레드', value: '레드', hex: '#E53E3E' },
  { label: '핑크', value: '핑크', hex: '#ED64A6' },
  { label: '화이트', value: '화이트', hex: '#EDF2F7' },
  { label: '옐로우', value: '옐로우', hex: '#ECC94B' },
  { label: '오렌지', value: '오렌지', hex: '#ED8936' },
  { label: '퍼플', value: '퍼플', hex: '#805AD5' },
  { label: '블루', value: '블루', hex: '#4299E1' },
  { label: '그린', value: '그린', hex: '#48BB78' },
  { label: '무늬', value: '무늬', hex: '#B794F4' },
  { label: '브라운', value: '브라운', hex: '#975A16' },
  { label: '베이지', value: '베이지', hex: '#FEFCBF' },
  { label: '블랙', value: '블랙', hex: '#1A202C' },
  { label: '그레이', value: '그레이', hex: '#A0AEC0' },
];
const SKELETON_KEYS = ['first', 'second', 'third', 'fourth'];

// ① 외형 유지(UI 교체 P5): Mantine Container size sm(720px·좌우 md 16·아래 96)·Box·Stack(gap md 16·sm 12·xl 32)·
// Group(gap 0·12, 한 줄)·SimpleGrid cols 2(gap sm 12)·Skeleton(radius md 8)·Divider(gray-3 1px, hr = separator 역할)·
// Title order 3·4(22px·1.4, 18px·1.45)·Text(p, size xs 13px·1.4·sm 15px·1.45·xl 20px·1.65, lineClamp)·
// UnstyledButton·Button light(sm·xs)와 같은 값. text-xs·sm·xl은 tokens.css에서 Mantine과 같은 크기·줄 높이다.
// Mantine Button은 vertical-align: middle이라 블록 안에 놓인 버튼에는 align-middle을 준다.
const TEXT_XS = 'm-0 p-0 text-xs';
const TEXT_SM = 'm-0 p-0 text-sm';
const TEXT_XL = 'm-0 p-0 text-xl';
const LINE_CLAMP_2 = 'line-clamp-2 text-ellipsis';
const GRID = 'grid grid-cols-2 gap-3';
const ALERT_STACK = 'flex flex-col items-center justify-start gap-3 py-12';
const EMPTY_STACK = 'flex flex-col items-center justify-start gap-4 py-16';
const SECTION_TITLE = 'm-0 mb-4 text-[18px] leading-[1.45]';
const SECTION_TITLE_STYLE = { color: 'var(--color-text)', fontWeight: 'var(--fw-bold)' } as const;
const DIVIDER = 'm-0 h-0 border-0 border-t border-solid border-[#dee2e6]';
// Mantine UnstyledButton(+ 초점 링 mantine-focus-auto)과 같은 초기화. 모양은 각 버튼의 style이 준다.
const UNSTYLED_BUTTON =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-[16px] text-inherit no-underline touch-manipulation [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid';

type StoreModeStatus = 'loading' | 'ready' | StoreProfileFailure;

interface StoreModeState {
  storeId: string | null;
  salesMode: SalesMode;
  status: StoreModeStatus;
}

function findSingleStoreId(products: Product[]) {
  const storeIds = new Set(
    products.map((product) => product.storeId).filter((storeId) => storeId.length > 0),
  );
  return storeIds.size === 1 ? [...storeIds][0] : null;
}

function useStoreMode(storeId: string | null, discoveryPending: boolean): StoreModeState {
  const [state, setState] = useState<StoreModeState>({
    storeId: null,
    salesMode: 'legacy',
    status: 'loading',
  });

  useEffect(() => {
    if (discoveryPending) {
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
        setState({ storeId, salesMode: normalizeSalesMode(value), status: 'ready' });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ storeId, salesMode: 'legacy', status: classifyStoreProfileFailure(error) });
        }
      });

    return () => {
      active = false;
    };
  }, [discoveryPending, storeId]);

  return state;
}

function visibleOrchidItems(round: PublicSaleRound, productById: Map<string, Product>) {
  return [...round.items]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .filter((item) => {
      const product = productById.get(item.productId);
      return (
        item.status !== 'HIDDEN' &&
        product?.category === 'orchid' &&
        product.isActive &&
        product.storeId === round.storeId
      );
    });
}

/** 카드 라벨. 상품 탭 회차 라벨(category-round-label)이 켜지면 판매 예정 회차를 따로 부른다. */
function roundCardLabel(round: PublicSaleRound, isPast: boolean): string {
  if (isPast) return '지난 회차';
  if (isFeatureOn('category-round-label') && round.status === 'SCHEDULED') return '판매 예정';
  return '이번 주 회차';
}

function RoundProductCard({
  item,
  round,
  isPast,
}: {
  item: SaleRoundItem;
  round: PublicSaleRound;
  isPast: boolean;
}) {
  const label = roundCardLabel(round, isPast);
  const href = `/products/${encodeURIComponent(item.productId)}?round=${encodeURIComponent(round.id)}`;

  return (
    <Link
      href={href}
      aria-label={`${label} ${item.productNameSnapshot}`}
      style={{
        display: 'block',
        overflow: 'hidden',
        color: 'inherit',
        textDecoration: 'none',
        border: 'var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div
        style={{
          position: 'relative',
          aspectRatio: '4/5',
          overflow: 'hidden',
          background: 'var(--color-border)',
        }}
      >
        <Image
          fill
          src={item.productImageUrlSnapshot ?? '/images/product-placeholder.png'}
          alt={item.productNameSnapshot}
          sizes="(max-width: 600px) 50vw, 33vw"
          style={{ objectFit: 'cover' }}
        />
      </div>
      <div className="p-2.5">
        <p
          className={`${TEXT_XS} mb-1`}
          style={{ fontWeight: 700, color: 'var(--color-primary-dark)' }}
        >
          {label}
        </p>
        <CardSellerLine />
        <p
          className={`${TEXT_SM} ${LINE_CLAMP_2}`}
          style={{ fontWeight: 500, color: 'var(--color-text)' }}
        >
          {item.productNameSnapshot}
        </p>
        <p className={`${TEXT_SM} mt-1.5`} style={{ color: 'var(--color-text-disabled)' }}>
          회차 가격
        </p>
        <p className={TEXT_SM} style={{ fontWeight: 700, color: 'var(--color-text-secondary)' }}>
          {item.roundPrice.toLocaleString()}원
          <CardDiscount item={item} />
        </p>
        <CardMeta item={item} isPast={isPast} />
      </div>
    </Link>
  );
}

function RoundDirectCategory({
  products,
  currentRound,
  pastRounds,
  loading,
  error,
  isRefreshing,
  isStale,
  status,
  refetch,
}: ReturnType<typeof useSaleRounds> & { products: Product[] }) {
  const card = useHomeCardContext(currentRound?.storeId ?? null, products, currentRound?.id ?? null);
  if (loading) {
    return (
      // biome-ignore lint/a11y/useAriaPropsSupportedByRole: 교체 전(Mantine Stack·SimpleGrid·Container)과 같은 div의 aria-label이다. 역할 변경은 ② 단계에서 다룬다.
      <div
        className="flex flex-col items-stretch justify-start gap-4"
        aria-label="판매 회차 불러오는 중"
      >
        <BlockSkeleton height={72} />
        <div className={GRID}>
          {SKELETON_KEYS.map((key) => (
            <BlockSkeleton key={key} height={260} />
          ))}
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={ALERT_STACK} role="alert">
        <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
          판매 회차를 불러오지 못했습니다.
        </p>
        {error && (
          <p className={TEXT_SM} style={{ color: 'var(--color-text-disabled)' }}>
            {error}
          </p>
        )}
        <Button type="button" variant="light" onClick={refetch}>
          다시 시도
        </Button>
      </div>
    );
  }

  const productById = new Map(products.map((product) => [product.id, product]));
  const currentItems = currentRound ? visibleOrchidItems(currentRound, productById) : [];
  const pastRoundItems = pastRounds
    .map((round) => ({ round, items: visibleOrchidItems(round, productById) }))
    .filter(({ items }) => items.length > 0);

  if (currentItems.length === 0 && pastRoundItems.length === 0) {
    return (
      <div className={EMPTY_STACK}>
        <p className={TEXT_XL}>🌱</p>
        <p className={TEXT_SM} style={{ color: 'var(--color-text-disabled)' }}>
          현재 또는 지난 판매 회차에 판매 중인 호접란이 없습니다.
        </p>
      </div>
    );
  }

  return (
    <BenchmarkCardProvider value={card}>
    <div className="flex flex-col items-stretch justify-start gap-8">
      {isRefreshing && (
        <p
          className={`${TEXT_SM} text-center`}
          style={{ color: 'var(--color-text-secondary)' }}
          aria-live="polite"
        >
          최신 회차 정보를 확인하는 중...
        </p>
      )}
      {isStale && (
        <div
          className="p-3"
          role="alert"
          style={{
            background: 'var(--color-primary-surface)',
            borderRadius: 'var(--radius)',
            border: 'var(--border)',
          }}
        >
          <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
            최신 회차 정보를 불러오지 못했습니다. 이전 결과를 표시합니다.
          </p>
          {error && (
            <p className={`${TEXT_SM} mt-1`} style={{ color: 'var(--color-text-disabled)' }}>
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
      <section aria-labelledby="current-category-round">
        <h4 id="current-category-round" className={SECTION_TITLE} style={SECTION_TITLE_STYLE}>
          {currentRound?.status === 'SCHEDULED' ? '판매 예정 회차' : '이번 주 회차'}
        </h4>
        {currentRound && currentItems.length > 0 ? (
          <div className="flex flex-col items-stretch justify-start gap-3">
            <p
              className={TEXT_SM}
              style={{ fontWeight: 700, color: 'var(--color-text-secondary)' }}
            >
              {currentRound.name}
              {currentRound.status === 'CLOSED' ? ' · 주문 마감' : ''}
            </p>
            <div className={GRID}>
              {currentItems.map((item) => (
                <RoundProductCard key={item.id} item={item} round={currentRound} isPast={false} />
              ))}
            </div>
          </div>
        ) : (
          <p className={`${TEXT_SM} py-4`} style={{ color: 'var(--color-text-disabled)' }}>
            현재 회차에 판매 중인 호접란이 없습니다.
          </p>
        )}
      </section>

      <hr className={DIVIDER} />

      <section aria-labelledby="past-category-round">
        <h4 id="past-category-round" className={SECTION_TITLE} style={SECTION_TITLE_STYLE}>
          지난 회차
        </h4>
        {pastRoundItems.length > 0 ? (
          <div className="flex flex-col items-stretch justify-start gap-8">
            {pastRoundItems.map(({ round, items }) => (
              <div key={round.id}>
                <p
                  className={`${TEXT_SM} mb-3`}
                  style={{ fontWeight: 700, color: 'var(--color-text-secondary)' }}
                >
                  {round.name}
                </p>
                <div className={GRID}>
                  {items.map((item) => (
                    <RoundProductCard key={item.id} item={item} round={round} isPast />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={`${TEXT_SM} py-4`} style={{ color: 'var(--color-text-disabled)' }}>
            지난 회차에 공개된 호접란이 없습니다.
          </p>
        )}
      </section>
      {isFeatureOn('product-request') && <ProductRequestBox storeId={currentRound?.storeId ?? null} />}
    </div>
    </BenchmarkCardProvider>
  );
}

function LegacyCategory({
  selectedTab,
  setSelectedTab,
  selectedColors,
  toggleColor,
  products,
  loading,
  error,
  refetch,
}: {
  selectedTab: number;
  setSelectedTab: (index: number) => void;
  selectedColors: ColorOption[];
  toggleColor: (color: ColorOption) => void;
  products: Product[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}) {
  return (
    <>
      <div className="pb-3" style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
        <div className="flex flex-row flex-nowrap items-center justify-start gap-0">
          {TABS.map((tab, index) => {
            const isActive = selectedTab === index;
            return (
              <button
                type="button"
                key={tab.label}
                onClick={() => setSelectedTab(index)}
                className={UNSTYLED_BUTTON}
                style={{
                  flexShrink: 0,
                  padding: '8px 16px',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: isActive ? 'var(--fw-bold)' : 'normal',
                  color: isActive ? 'var(--color-text)' : 'var(--color-text-disabled)',
                  borderBottom: isActive ? '2px solid var(--color-text)' : '2px solid transparent',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <hr className={DIVIDER} />
      </div>

      <div className="mb-3 py-3" style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
        <div className="flex flex-row flex-nowrap items-center justify-start gap-3">
          {COLOR_CHIPS.map((chip) => {
            const isActive = selectedColors.includes(chip.value);
            return (
              <button
                type="button"
                key={chip.value}
                onClick={() => toggleColor(chip.value)}
                className={UNSTYLED_BUTTON}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    backgroundColor: chip.hex,
                    border: isActive
                      ? '2px solid var(--color-text)'
                      : '2px solid var(--color-border)',
                    outline: isActive ? '2px solid var(--color-text)' : '2px solid transparent',
                    outlineOffset: 2,
                  }}
                />
                <p
                  className={TEXT_SM}
                  style={{
                    color: isActive ? 'var(--color-text)' : 'var(--color-text-disabled)',
                    fontWeight: isActive ? 700 : 500,
                  }}
                >
                  {chip.label}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <hr className={`${DIVIDER} mb-4`} />

      {loading && (
        <div className={GRID}>
          {SKELETON_KEYS.map((key) => (
            <BlockSkeleton key={key} height={260} />
          ))}
        </div>
      )}
      {!loading && error && (
        <div className={ALERT_STACK} role="alert">
          <p className={`${TEXT_SM} text-center`} style={{ color: 'var(--color-text-disabled)' }}>
            {error}
          </p>
          <Button type="button" variant="light" onClick={refetch} data-testid="products-retry">
            다시 시도
          </Button>
        </div>
      )}
      {!loading && !error && products.length === 0 && (
        <div className={EMPTY_STACK}>
          <p className={TEXT_XL}>🌱</p>
          <p className={TEXT_SM} style={{ color: 'var(--color-text-disabled)' }}>
            해당 카테고리 상품이 없습니다.
          </p>
        </div>
      )}
      {!loading && products.length > 0 && (
        <>
          <p
            className={`${TEXT_SM} mb-3`}
            style={{ color: 'var(--color-text-disabled)', fontWeight: 500 }}
          >
            {products.length}개 상품
          </p>
          <div className={GRID}>
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default function CategoryPage() {
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedColors, setSelectedColors] = useState<ColorOption[]>([]);
  const [discoveredStoreId, setDiscoveredStoreId] = useState<string | null | undefined>(undefined);

  const activeTab = TABS[selectedTab];
  const { products, loading, error, refetch } = useProducts(
    activeTab.value,
    selectedColors,
    activeTab.saleType,
  );
  const isDiscoveryQuery = selectedTab === 0 && selectedColors.length === 0;

  useEffect(() => {
    if (discoveredStoreId === undefined && isDiscoveryQuery && !loading) {
      setDiscoveredStoreId(findSingleStoreId(products));
    }
  }, [discoveredStoreId, isDiscoveryQuery, loading, products]);

  const storeMode = useStoreMode(discoveredStoreId ?? null, discoveredStoreId === undefined);
  const saleRounds = useSaleRounds(
    storeMode.salesMode === 'round_direct' ? storeMode.storeId : null,
  );

  function toggleColor(color: ColorOption) {
    setSelectedColors((previous) =>
      previous.includes(color) ? previous.filter((item) => item !== color) : [...previous, color],
    );
  }

  let content = (
    <LegacyCategory
      selectedTab={selectedTab}
      setSelectedTab={setSelectedTab}
      selectedColors={selectedColors}
      toggleColor={toggleColor}
      products={products}
      loading={loading}
      error={error}
      refetch={refetch}
    />
  );
  if (storeMode.status === 'loading') {
    content = (
      // biome-ignore lint/a11y/useAriaPropsSupportedByRole: 교체 전(Mantine Stack·SimpleGrid·Container)과 같은 div의 aria-label이다. 역할 변경은 ② 단계에서 다룬다.
      <div className={GRID} aria-label="판매 정보 불러오는 중">
        {SKELETON_KEYS.map((key) => (
          <BlockSkeleton key={key} height={260} />
        ))}
      </div>
    );
  } else if (storeMode.status !== 'ready') {
    content = (
      <div className="flex flex-col items-center justify-start gap-4 py-12" role="alert">
        <p className={TEXT_SM} style={{ color: 'var(--color-text-secondary)' }}>
          {storeProfileFailureMessage(storeMode.status)}
        </p>
      </div>
    );
  } else if (storeMode.salesMode === 'round_direct') {
    content = <RoundDirectCategory products={products} {...saleRounds} />;
  }

  return (
    <div className="mx-auto max-w-[720px] px-4 pb-24">
      <div className="px-4 pt-5 pb-4">
        <h3
          className="m-0 text-[22px] leading-[1.4]"
          style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}
        >
          상품
        </h3>
      </div>
      <div className="px-4">{content}</div>
    </div>
  );
}
