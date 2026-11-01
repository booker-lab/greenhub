'use client';

import type { Product, SaleRoundItem, SalesMode, Variety } from '@greenhub/shared';
import { normalizeSalesMode } from '@greenhub/shared';
import { Button, ButtonLink } from '@greenhub/ui/components/button';
import Link from 'next/link';
import { notFound, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import DetailExtras from '@/components/benchmark/DetailExtras';
import PanelExtras from '@/components/benchmark/PanelExtras';
import ProductTopBar from '@/components/ProductTopBar';
import {
  loadPublicSaleRoundsState,
  type PublicSaleRound,
  usePublicSaleRound,
  useSaleRounds,
} from '@/hooks/useSaleRounds';
import { captureAcquisition } from '@/lib/acquisition';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { classifyStoreProfileFailure, fetchPublicStoreProfile } from '@/lib/public-store-profile';
import ProductActions from './_components/ProductActions';
import ProductImages from './_components/ProductImages';
import ProductInfo from './_components/ProductInfo';
import RoundPurchasePanel, { RoundPurchaseNotices } from './_components/RoundPurchasePanel';
import type { ProductLoadHint } from './product-server';

const API_URL = getApiBaseUrl();
const MAX_ROUND_ID_LENGTH = 128;
const UNSAFE_ROUND_ID_CHARACTERS = '/?#\\';

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; product: Product; variety: Variety | null }
  | { status: 'not_found' }
  | { status: 'error' };

type StoreModeState =
  | { status: 'loading'; storeId: string | null; salesMode: 'legacy' }
  | { status: 'ready'; storeId: string; salesMode: SalesMode }
  | { status: 'error' | 'unavailable'; storeId: string | null; salesMode: 'legacy' };

interface RoundProduct {
  round: PublicSaleRound;
  item: SaleRoundItem;
  state: 'current' | 'closed' | 'sold_out';
  isPurchasable: boolean;
}

interface ProductDetailContentProps {
  product: Product;
  variety: Variety | null;
  roundProduct: RoundProduct | null;
}

interface ProductDetailClientProps {
  id: string;
  hint: ProductLoadHint | null;
}

// 주소의 round 값(searchParams.getAll('round')). 정확히 하나일 때만 받는다.
function readRoundId(values: string[]) {
  if (values.length !== 1) return null;
  const value = values[0];
  const trimmed = value.trim();
  const containsUnsafeCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || UNSAFE_ROUND_ID_CHARACTERS.includes(character);
  });
  if (
    trimmed !== value ||
    value.length === 0 ||
    value.length > MAX_ROUND_ID_LENGTH ||
    containsUnsafeCharacter
  ) {
    return null;
  }
  return value;
}

async function fetchProduct(id: string, signal: AbortSignal): Promise<Product | null> {
  const response = await fetch(`${API_URL}/products/${encodeURIComponent(id)}`, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`상품 조회 오류: ${response.status}`);

  const product = (await response.json()) as Product;
  return product.id === id ? product : null;
}

async function fetchVariety(varietyId: string, signal: AbortSignal): Promise<Variety | null> {
  try {
    const response = await fetch(`${API_URL}/varieties/${encodeURIComponent(varietyId)}`, {
      signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as Variety;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return null;
  }
}

function useProductDetail(id: string, hintVarietyId: string | null): DetailState {
  const [detail, setDetail] = useState<DetailState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setDetail({ status: 'loading' });
    // 서버가 알려 준 품종을 상품 조회와 함께 읽는다. 최신 상품의 품종이 다르면 그때 다시 읽는다.
    const hintedVariety = hintVarietyId ? fetchVariety(hintVarietyId, controller.signal) : null;
    hintedVariety?.catch(() => {});

    void fetchProduct(id, controller.signal)
      .then(async (product) => {
        if (!product) {
          setDetail({ status: 'not_found' });
          return;
        }
        const variety = !product.varietyId
          ? null
          : product.varietyId === hintVarietyId && hintedVariety
            ? await hintedVariety
            : await fetchVariety(product.varietyId, controller.signal);
        setDetail({ status: 'ready', product, variety });
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          setDetail({ status: 'error' });
        }
      });

    return () => controller.abort();
  }, [id, hintVarietyId]);

  return detail;
}

function useStoreMode(storeId: string | null): StoreModeState {
  const [storeMode, setStoreMode] = useState<StoreModeState>({
    status: 'loading',
    storeId: null,
    salesMode: 'legacy',
  });

  useEffect(() => {
    if (!storeId) {
      setStoreMode({ status: 'loading', storeId: null, salesMode: 'legacy' });
      return;
    }

    let active = true;
    setStoreMode({ status: 'loading', storeId, salesMode: 'legacy' });

    void fetchPublicStoreProfile(storeId)
      .then((profile) => {
        if (!active) return;
        const value = profile.salesMode;
        if (value !== 'legacy' && value !== 'round_direct') {
          throw new Error('판매 방식 정보가 올바르지 않습니다.');
        }
        setStoreMode({
          status: 'ready',
          storeId,
          salesMode: normalizeSalesMode(value),
        });
      })
      .catch((error: unknown) => {
        const status = classifyStoreProfileFailure(error);
        if (active) setStoreMode({ status, storeId, salesMode: 'legacy' });
      });

    return () => {
      active = false;
    };
  }, [storeId]);

  return storeMode;
}

function resolveRoundProduct(
  product: Product,
  roundId: string,
  currentRound: PublicSaleRound | null,
  pastRounds: PublicSaleRound[],
): RoundProduct | null {
  const round =
    currentRound?.id === roundId
      ? currentRound
      : pastRounds.find((candidate) => candidate.id === roundId);
  if (!round || round.storeId !== product.storeId) return null;

  const matchingItems = round.items.filter(
    (item) =>
      item.roundId === round.id &&
      item.storeId === product.storeId &&
      item.productId === product.id &&
      item.status !== 'HIDDEN',
  );
  if (matchingItems.length !== 1) return null;

  const item = matchingItems[0];
  const isCurrentRound = round.status === 'OPEN' || round.status === 'SCHEDULED';
  const isCurrentItem = item.status === 'ACTIVE';
  // 판매 중 회차에서 수량이 찬 상품(결제 대기 예약 포함)은 회차 마감이 아니라 품절로 보인다.
  const isSoldOut = isCurrentRound && item.status === 'SOLD_OUT';

  return {
    round,
    item,
    state: isCurrentRound && isCurrentItem ? 'current' : isSoldOut ? 'sold_out' : 'closed',
    isPurchasable: round.status === 'OPEN' && isCurrentItem,
  };
}

/**
 * round 없이 들어온 상품 주소(카카오 채널 소식·홈 대표 판매상품 등)는 공개 현재 회차(판매 중·판매 예정)에
 * 이 상품이 실제로 있을 때만 그 회차로 잇는다. 지난 회차·다른 스토어로는 잇지 않고, round가 잘못 지정된
 * 주소에도 임의 기본값을 만들지 않는다(같은 resolveRoundProduct 검증을 쓴다).
 */
function findCurrentRoundIdForProduct(product: Product, currentRound: PublicSaleRound | null) {
  if (!currentRound) return null;
  return resolveRoundProduct(product, currentRound.id, currentRound, []) ? currentRound.id : null;
}

// Mantine Skeleton(기본 모서리 16px, gray-3 면, 1.5초 깜빡임) 계산값. 면은 바탕(body) 위에 gray-3을 겹친다.
// Mantine의 깜빡임(opacity 0.4↔1, 1500ms linear)은 같은 길이의 pulse(opacity 1↔0.5)로 그린다.
function DetailSkeleton({
  height,
  width = '100%',
  radius = 16,
}: {
  height: number;
  width?: string;
  radius?: number;
}) {
  return (
    <div
      className="relative overflow-hidden [transform:translateZ(0)]"
      style={{ height, width, borderRadius: radius }}
    >
      <span className="absolute inset-0 z-10 bg-white" />
      <span className="absolute inset-0 z-[11] animate-[pulse_1500ms_linear_infinite] bg-[#dee2e6]" />
    </div>
  );
}

function DetailStateFrame({
  label,
  message,
  alert = false,
}: {
  label: string;
  message?: string;
  alert?: boolean;
}) {
  return (
    <div className="mx-auto max-w-[720px] p-0">
      <ProductTopBar />
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: Mantine Stack과 같은 마크업(role 없는 불러오는 중 상태에도 aria-label)을 유지한다(① 외형 유지) */}
      <div
        className="flex flex-col gap-4 px-4"
        style={{ paddingTop: 'calc(76px + env(safe-area-inset-top))' }}
        role={alert ? 'alert' : undefined}
        aria-label={label}
      >
        {message ? (
          <p
            className="m-0 py-12 text-center text-sm"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {message}
          </p>
        ) : (
          <>
            <DetailSkeleton height={360} radius={0} />
            <DetailSkeleton height={32} width="70%" />
            <DetailSkeleton height={24} width="40%" />
          </>
        )}
      </div>
    </div>
  );
}

// 회차에 없는 상품(카카오 채널·대표 판매상품 링크 등으로 들어옴)은 막다른 안내 대신 사진·이름·설명을
// 보여 주고, 원래 가격·구매 버튼 자리에 이번 주 상품으로 가는 안내를 둔다(회차 가격과 헷갈리지 않게).
function RoundUnavailableProductDetail({
  product,
  variety,
  label,
  message,
}: {
  product: Product;
  variety: Variety | null;
  label: string;
  message: string;
}) {
  return (
    <div className="mx-auto max-w-[720px] p-0">
      <ProductTopBar />
      <div
        data-sales-mode="round_direct"
        data-round-state="unavailable"
        style={{ paddingTop: 'calc(52px + env(safe-area-inset-top))' }}
      >
        <ProductImages images={product.images ?? []} name={product.name} />
        <div className="flex flex-col gap-3 px-4 pt-5">
          <h1
            style={{
              color: 'var(--color-text)',
              fontSize: 22,
              fontWeight: 'var(--fw-extrabold)',
              lineHeight: 1.3,
              margin: 0,
            }}
          >
            {product.name}
          </h1>
          <div
            className="p-4"
            role="status"
            aria-label={label}
            style={{ background: 'var(--color-deadline-surface)', borderRadius: 'var(--radius)' }}
          >
            <p
              className="m-0 leading-[1.55]"
              style={{
                color: 'var(--color-deadline-text)',
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-extrabold)',
              }}
            >
              {message}
            </p>
            <p className="m-0 mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              회차마다 경매에서 고른 상품이 바뀌어요. 이번 주 판매 상품을 확인해 주세요.
            </p>
            {/* 링크 의미(a)를 유지한다: Mantine Button component={Link} fullWidth mt="md" size="md" */}
            <ButtonLink render={<Link href="/" />} size="md" className="mt-4 w-full">
              이번 주 상품 보기
            </ButtonLink>
          </div>
        </div>
        <ProductInfo product={product} variety={variety} showSummary={false} />
      </div>
    </div>
  );
}

function ProductDetailContent({ product, variety, roundProduct }: ProductDetailContentProps) {
  return (
    <div className="mx-auto max-w-[720px] p-0">
      <ProductTopBar />
      <div
        data-sales-mode={roundProduct ? 'round_direct' : 'legacy'}
        data-round-state={roundProduct?.state}
        style={{ paddingTop: 'calc(52px + env(safe-area-inset-top))' }}
      >
        <ProductImages images={product.images ?? []} name={product.name} />
        {/* 회차 상품은 이름·회차 가격을 패널에서 보여주므로 상품 정보의 이름·원래 가격은 숨긴다 */}
        {roundProduct && (
          <RoundPurchasePanel
            round={roundProduct.round}
            item={roundProduct.item}
            state={roundProduct.state}
            isPurchasable={roundProduct.isPurchasable}
          />
        )}
        {roundProduct && <PanelExtras product={product} item={roundProduct.item} />}
        <ProductInfo product={product} variety={variety} showSummary={!roundProduct} />
        {roundProduct && <DetailExtras product={product} round={roundProduct.round} />}
        {roundProduct && <RoundPurchaseNotices />}
        {roundProduct ? (
          <ProductActions product={product} roundProduct={roundProduct} />
        ) : (
          <ProductActions product={product} />
        )}
      </div>
    </div>
  );
}

function RoundDirectProductDetail({
  product,
  variety,
}: {
  product: Product;
  variety: Variety | null;
}) {
  // 상품 화면은 정적으로 만들어지므로 회차 쿼리는 서버가 아니라 브라우저 주소에서 읽는다.
  // 이 화면은 상품·판매 방식 조회가 끝난 뒤에만 그려져 정적 렌더 중에는 쿼리를 읽지 않는다.
  const searchParams = useSearchParams();
  const roundId = readRoundId(searchParams.getAll('round'));
  const saleRounds = useSaleRounds(product.storeId);
  const router = useRouter();
  const pathname = usePathname();
  const roundsSettled = saleRounds.status !== 'loading' && saleRounds.status !== 'error';
  const linkedRoundId =
    !roundId && roundsSettled
      ? findCurrentRoundIdForProduct(product, saleRounds.currentRound)
      : null;
  // 회차 목록은 최근 지난 회차만 담는다. 주소의 회차가 목록에 없으면(예전에 공유된 링크) 그 회차만 따로 읽는다.
  const unlistedRoundId =
    roundId &&
    roundsSettled &&
    saleRounds.currentRound?.id !== roundId &&
    !saleRounds.pastRounds.some((round) => round.id === roundId)
      ? roundId
      : null;
  const unlistedRound = usePublicSaleRound(product.storeId, unlistedRoundId);

  // 연결한 회차를 주소에도 남겨 공유·새로고침 때 같은 회차가 열리게 한다(당근 유입 값 등 다른 쿼리는 보존).
  useEffect(() => {
    if (!linkedRoundId) return;
    const query = new URLSearchParams(window.location.search);
    query.set('round', linkedRoundId);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }, [linkedRoundId, pathname, router]);

  if (saleRounds.status === 'loading' || unlistedRound.status === 'loading') {
    return <DetailStateFrame label="판매 회차 불러오는 중" />;
  }
  if (saleRounds.status === 'error') {
    return (
      <div className="mx-auto max-w-[720px] p-0">
        <ProductTopBar />
        <div
          className="flex flex-col items-center gap-3 px-4"
          style={{ paddingTop: 'calc(76px + env(safe-area-inset-top))' }}
          role="alert"
          aria-label="판매 회차 조회 실패"
        >
          <p
            className="m-0 text-center py-3 text-sm"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            판매 회차를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </p>
          {saleRounds.error && (
            <p className="m-0 text-center text-sm" style={{ color: 'var(--color-text-disabled)' }}>
              {saleRounds.error}
            </p>
          )}
          <Button variant="light" size="xs" onClick={saleRounds.refetch}>
            다시 시도
          </Button>
        </div>
      </div>
    );
  }

  const effectiveRoundId = roundId ?? linkedRoundId;
  if (!effectiveRoundId) {
    return (
      <RoundUnavailableProductDetail
        product={product}
        variety={variety}
        label="판매 회차 확인 실패"
        message="이번 회차에서 판매하지 않는 상품이에요."
      />
    );
  }

  const roundProduct = resolveRoundProduct(
    product,
    effectiveRoundId,
    saleRounds.currentRound,
    unlistedRound.round ? [...saleRounds.pastRounds, unlistedRound.round] : saleRounds.pastRounds,
  );
  if (!roundProduct) {
    if (saleRounds.isStale) {
      return (
        <div className="mx-auto max-w-[720px] p-0">
          <ProductTopBar />
          <div
            className="flex flex-col items-center gap-3 px-4"
            style={{ paddingTop: 'calc(76px + env(safe-area-inset-top))' }}
            role="alert"
            aria-label="판매 회차 확인 실패"
          >
            <p className="m-0 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              최신 회차 정보를 불러오지 못했습니다. 이전 결과를 표시합니다.
            </p>
            {saleRounds.error && (
              <p
                className="m-0 text-center text-sm"
                style={{ color: 'var(--color-text-disabled)' }}
              >
                {saleRounds.error}
              </p>
            )}
            <Button variant="light" size="xs" onClick={saleRounds.refetch}>
              다시 시도
            </Button>
            <p
              className="m-0 text-center py-3 text-sm"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              이 상품에 연결된 공개 판매 회차를 찾을 수 없습니다.
            </p>
          </div>
        </div>
      );
    }
    return (
      <RoundUnavailableProductDetail
        product={product}
        variety={variety}
        label="판매 회차 상품 확인 실패"
        message="판매가 끝났거나 이번 회차에 없는 상품이에요."
      />
    );
  }

  if (saleRounds.isStale) {
    return (
      <>
        <div
          className="mx-auto max-w-[720px] px-4"
          style={{ paddingTop: 'calc(52px + env(safe-area-inset-top))' }}
        >
          <div
            className="mt-3 p-3"
            role="alert"
            style={{
              background: 'var(--color-primary-surface)',
              borderRadius: 'var(--radius)',
              border: 'var(--border)',
            }}
          >
            <p className="m-0 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              최신 회차 정보를 불러오지 못했습니다. 이전 결과를 표시합니다.
            </p>
            {saleRounds.error && (
              <p className="m-0 mt-1 text-sm" style={{ color: 'var(--color-text-disabled)' }}>
                {saleRounds.error}
              </p>
            )}
            <Button variant="light" size="xs" className="mt-2.5" onClick={saleRounds.refetch}>
              다시 시도
            </Button>
          </div>
        </div>
        <ProductDetailContent product={product} variety={variety} roundProduct={roundProduct} />
      </>
    );
  }

  if (saleRounds.isRefreshing) {
    return (
      <>
        <div
          className="mx-auto max-w-[720px] px-4"
          style={{ paddingTop: 'calc(52px + env(safe-area-inset-top))' }}
        >
          <p
            className="m-0 text-center text-sm"
            style={{ color: 'var(--color-text-secondary)' }}
            aria-live="polite"
          >
            최신 회차 정보를 확인하는 중...
          </p>
        </div>
        <ProductDetailContent product={product} variety={variety} roundProduct={roundProduct} />
      </>
    );
  }

  return <ProductDetailContent product={product} variety={variety} roundProduct={roundProduct} />;
}

export default function ProductDetailClient({ id, hint }: ProductDetailClientProps) {
  const validHint = hint?.id === id ? hint : null;
  const detail = useProductDetail(id, validHint?.varietyId ?? null);
  const readyProduct = detail.status === 'ready' ? detail.product : null;
  // 매장 판매 방식도 서버 단서로 상품 조회와 함께 읽는다. 아래에서 최신 상품의 매장과 같은지 다시 확인한다.
  const storeMode = useStoreMode(readyProduct?.storeId ?? validHint?.storeId ?? null);
  const hintStoreId = validHint?.storeId ?? null;

  useEffect(() => {
    captureAcquisition();
  }, []);

  // 상품·판매 방식 조회가 끝나기를 기다리지 않고 서버 단서의 매장으로 회차 조회를 함께 시작한다.
  // 같은 매장 회차 조회는 잠깐 공유되므로(lib/shared-request) 회차 화면의 useSaleRounds가 이 요청을 그대로 받는다.
  useEffect(() => {
    if (hintStoreId) void loadPublicSaleRoundsState(hintStoreId);
  }, [hintStoreId]);

  if (detail.status === 'not_found') notFound();
  if (detail.status === 'error') {
    return (
      <DetailStateFrame
        label="상품 조회 실패"
        message="상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
        alert
      />
    );
  }
  if (detail.status !== 'ready' || detail.product.id !== id) {
    return <DetailStateFrame label="상품 정보 불러오는 중" />;
  }

  const { product, variety } = detail;
  if (!product.storeId) {
    return (
      <DetailStateFrame
        label="판매 정보 조회 실패"
        message="판매 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
        alert
      />
    );
  }
  if (storeMode.status !== 'ready' || storeMode.storeId !== product.storeId) {
    // 관리자가 치운 가게의 상품은 없는 상품과 같게 보여 준다(다시 시도해도 같다).
    if (storeMode.status === 'unavailable' && storeMode.storeId === product.storeId) notFound();
    if (storeMode.status === 'error') {
      return (
        <DetailStateFrame
          label="판매 정보 조회 실패"
          message="판매 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
          alert
        />
      );
    }
    return <DetailStateFrame label="판매 정보 불러오는 중" />;
  }

  if (storeMode.salesMode !== 'round_direct') {
    return <ProductDetailContent product={product} variety={variety} roundProduct={null} />;
  }

  return <RoundDirectProductDetail key={storeMode.storeId} product={product} variety={variety} />;
}
