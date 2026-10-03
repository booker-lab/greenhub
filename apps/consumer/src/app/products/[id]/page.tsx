'use client';

import type { Product, SaleRoundItem, SalesMode, Variety } from '@greenhub/shared';
import { normalizeSalesMode } from '@greenhub/shared';
import { Box, Button, Container, Skeleton, Stack, Text } from '@mantine/core';
import Link from 'next/link';
import { notFound, usePathname, useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import ProductTopBar from '@/components/ProductTopBar';
import { type PublicSaleRound, useSaleRounds } from '@/hooks/useSaleRounds';
import { captureAcquisition } from '@/lib/acquisition';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { fetchPublicStoreProfile } from '@/lib/public-store-profile';
import ProductActions from './_components/ProductActions';
import ProductImages from './_components/ProductImages';
import ProductInfo from './_components/ProductInfo';
import RoundPurchasePanel, { RoundPurchaseNotices } from './_components/RoundPurchasePanel';

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
  | { status: 'error'; storeId: string | null; salesMode: 'legacy' };

interface RoundProduct {
  round: PublicSaleRound;
  item: SaleRoundItem;
  state: 'current' | 'closed';
  isPurchasable: boolean;
}

interface ProductDetailContentProps {
  product: Product;
  variety: Variety | null;
  roundProduct: RoundProduct | null;
}

interface ProductDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    round?: string | string[];
    [key: string]: string | string[] | undefined;
  }>;
}

function readRoundId(value: string | string[] | undefined) {
  if (typeof value !== 'string') return null;
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

function useProductDetail(id: string): DetailState {
  const [detail, setDetail] = useState<DetailState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setDetail({ status: 'loading' });

    void fetchProduct(id, controller.signal)
      .then(async (product) => {
        if (!product) {
          setDetail({ status: 'not_found' });
          return;
        }
        const variety = product.varietyId
          ? await fetchVariety(product.varietyId, controller.signal)
          : null;
        setDetail({ status: 'ready', product, variety });
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          setDetail({ status: 'error' });
        }
      });

    return () => controller.abort();
  }, [id]);

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
      .catch(() => {
        if (active) setStoreMode({ status: 'error', storeId, salesMode: 'legacy' });
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

  return {
    round,
    item,
    state: isCurrentRound && isCurrentItem ? 'current' : 'closed',
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
    <Container size="sm" p={0}>
      <ProductTopBar />
      <Stack
        px="md"
        pt="calc(76px + env(safe-area-inset-top))"
        gap="md"
        role={alert ? 'alert' : undefined}
        aria-label={label}
      >
        {message ? (
          <Text ta="center" py={48} c="var(--color-text-secondary)" size="sm">
            {message}
          </Text>
        ) : (
          <>
            <Skeleton height={360} radius={0} />
            <Skeleton height={32} width="70%" />
            <Skeleton height={24} width="40%" />
          </>
        )}
      </Stack>
    </Container>
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
    <Container size="sm" p={0}>
      <ProductTopBar />
      <Box
        data-sales-mode="round_direct"
        data-round-state="unavailable"
        style={{ paddingTop: 'calc(52px + env(safe-area-inset-top))' }}
      >
        <ProductImages images={product.images ?? []} name={product.name} />
        <Stack gap="sm" px="md" pt="lg">
          <Text
            component="h1"
            style={{
              color: 'var(--color-text)',
              fontSize: 22,
              fontWeight: 'var(--fw-extrabold)',
              lineHeight: 1.3,
              margin: 0,
            }}
          >
            {product.name}
          </Text>
          <Box
            p="md"
            role="status"
            aria-label={label}
            style={{ background: 'var(--color-deadline-surface)', borderRadius: 'var(--radius)' }}
          >
            <Text
              style={{
                color: 'var(--color-deadline-text)',
                fontSize: 'var(--font-size-md)',
                fontWeight: 'var(--fw-extrabold)',
              }}
            >
              {message}
            </Text>
            <Text mt={4} size="sm" c="var(--color-text-secondary)">
              회차마다 경매에서 고른 상품이 바뀌어요. 이번 주 판매 상품을 확인해 주세요.
            </Text>
            <Button component={Link} href="/" fullWidth mt="md" size="md">
              이번 주 상품 보기
            </Button>
          </Box>
        </Stack>
        <ProductInfo product={product} variety={variety} showSummary={false} />
      </Box>
    </Container>
  );
}

function ProductDetailContent({ product, variety, roundProduct }: ProductDetailContentProps) {
  return (
    <Container size="sm" p={0}>
      <ProductTopBar />
      <Box
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
        <ProductInfo product={product} variety={variety} showSummary={!roundProduct} />
        {roundProduct && <RoundPurchaseNotices />}
        {roundProduct ? (
          <ProductActions product={product} roundProduct={roundProduct} />
        ) : (
          <ProductActions product={product} />
        )}
      </Box>
    </Container>
  );
}

function RoundDirectProductDetail({
  product,
  variety,
  roundId,
}: {
  product: Product;
  variety: Variety | null;
  roundId: string | null;
}) {
  const saleRounds = useSaleRounds(product.storeId);
  const router = useRouter();
  const pathname = usePathname();
  const roundsSettled = saleRounds.status !== 'loading' && saleRounds.status !== 'error';
  const linkedRoundId =
    !roundId && roundsSettled
      ? findCurrentRoundIdForProduct(product, saleRounds.currentRound)
      : null;

  // 연결한 회차를 주소에도 남겨 공유·새로고침 때 같은 회차가 열리게 한다(당근 유입 값 등 다른 쿼리는 보존).
  useEffect(() => {
    if (!linkedRoundId) return;
    const query = new URLSearchParams(window.location.search);
    query.set('round', linkedRoundId);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }, [linkedRoundId, pathname, router]);

  if (saleRounds.status === 'loading') {
    return <DetailStateFrame label="판매 회차 불러오는 중" />;
  }
  if (saleRounds.status === 'error') {
    return (
      <Container size="sm" p={0}>
        <ProductTopBar />
        <Stack
          px="md"
          pt="calc(76px + env(safe-area-inset-top))"
          gap="sm"
          role="alert"
          aria-label="판매 회차 조회 실패"
          align="center"
        >
          <Text ta="center" py={12} c="var(--color-text-secondary)" size="sm">
            판매 회차를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </Text>
          {saleRounds.error && (
            <Text ta="center" c="var(--color-text-disabled)" size="sm">
              {saleRounds.error}
            </Text>
          )}
          <Button variant="light" size="xs" onClick={saleRounds.refetch}>
            다시 시도
          </Button>
        </Stack>
      </Container>
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
    saleRounds.pastRounds,
  );
  if (!roundProduct) {
    if (saleRounds.isStale) {
      return (
        <Container size="sm" p={0}>
          <ProductTopBar />
          <Stack
            px="md"
            pt="calc(76px + env(safe-area-inset-top))"
            gap="sm"
            role="alert"
            aria-label="판매 회차 확인 실패"
            align="center"
          >
            <Text ta="center" c="var(--color-text-secondary)" size="sm">
              최신 회차 정보를 불러오지 못했습니다. 이전 결과를 표시합니다.
            </Text>
            {saleRounds.error && (
              <Text ta="center" c="var(--color-text-disabled)" size="sm">
                {saleRounds.error}
              </Text>
            )}
            <Button variant="light" size="xs" onClick={saleRounds.refetch}>
              다시 시도
            </Button>
            <Text ta="center" py={12} c="var(--color-text-secondary)" size="sm">
              이 상품에 연결된 공개 판매 회차를 찾을 수 없습니다.
            </Text>
          </Stack>
        </Container>
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
        <Container size="sm" px="md" pt="calc(52px + env(safe-area-inset-top))">
          <Box
            p="sm"
            mt="sm"
            role="alert"
            style={{
              background: 'var(--color-primary-surface)',
              borderRadius: 'var(--radius)',
              border: 'var(--border)',
            }}
          >
            <Text size="sm" c="var(--color-text-secondary)">
              최신 회차 정보를 불러오지 못했습니다. 이전 결과를 표시합니다.
            </Text>
            {saleRounds.error && (
              <Text size="sm" c="var(--color-text-disabled)" mt={4}>
                {saleRounds.error}
              </Text>
            )}
            <Button variant="light" size="xs" mt="xs" onClick={saleRounds.refetch}>
              다시 시도
            </Button>
          </Box>
        </Container>
        <ProductDetailContent product={product} variety={variety} roundProduct={roundProduct} />
      </>
    );
  }

  if (saleRounds.isRefreshing) {
    return (
      <>
        <Container size="sm" px="md" pt="calc(52px + env(safe-area-inset-top))">
          <Text size="sm" c="var(--color-text-secondary)" ta="center" aria-live="polite">
            최신 회차 정보를 확인하는 중...
          </Text>
        </Container>
        <ProductDetailContent product={product} variety={variety} roundProduct={roundProduct} />
      </>
    );
  }

  return <ProductDetailContent product={product} variety={variety} roundProduct={roundProduct} />;
}

export default function ProductDetailPage({ params, searchParams }: ProductDetailPageProps) {
  const { id } = use(params);
  const query = use(searchParams);
  const roundId = readRoundId(query.round);
  const detail = useProductDetail(id);
  const readyProduct = detail.status === 'ready' ? detail.product : null;
  const storeMode = useStoreMode(readyProduct?.storeId ?? null);

  useEffect(() => {
    captureAcquisition();
  }, []);

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

  return (
    <RoundDirectProductDetail
      key={storeMode.storeId}
      product={product}
      variety={variety}
      roundId={roundId}
    />
  );
}
