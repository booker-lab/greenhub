'use client';

import type { Product, SaleRoundItem, SalesMode, Variety } from '@greenhub/shared';
import { normalizeSalesMode } from '@greenhub/shared';
import { Box, Container, Skeleton, Stack, Text } from '@mantine/core';
import { doc, getDoc } from 'firebase/firestore';
import { notFound } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import ProductTopBar from '@/components/ProductTopBar';
import { type PublicSaleRound, useSaleRounds } from '@/hooks/useSaleRounds';
import { db } from '@/lib/firebase';
import ProductActions from './_components/ProductActions';
import ProductImages from './_components/ProductImages';
import ProductInfo from './_components/ProductInfo';
import RoundPurchasePanel from './_components/RoundPurchasePanel';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
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

    void getDoc(doc(db, 'stores', storeId))
      .then((snapshot) => {
        if (!active) return;
        if (!snapshot.exists()) throw new Error('스토어를 찾을 수 없습니다.');

        const value = snapshot.data()?.salesMode;
        if (value !== undefined && value !== 'legacy' && value !== 'round_direct') {
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
        <ProductInfo product={product} variety={variety} />
        {roundProduct && (
          <RoundPurchasePanel
            round={roundProduct.round}
            item={roundProduct.item}
            state={roundProduct.state}
            isPurchasable={roundProduct.isPurchasable}
          />
        )}
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

  if (!roundId) {
    return (
      <DetailStateFrame
        label="판매 회차 확인 실패"
        message="유효한 판매 회차가 지정되지 않았습니다."
        alert
      />
    );
  }
  if (saleRounds.status === 'loading') {
    return <DetailStateFrame label="판매 회차 불러오는 중" />;
  }
  if (saleRounds.status === 'error') {
    return (
      <DetailStateFrame
        label="판매 회차 조회 실패"
        message="판매 회차를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
        alert
      />
    );
  }

  const roundProduct = resolveRoundProduct(
    product,
    roundId,
    saleRounds.currentRound,
    saleRounds.pastRounds,
  );
  if (!roundProduct) {
    return (
      <DetailStateFrame
        label="판매 회차 상품 확인 실패"
        message="이 상품에 연결된 공개 판매 회차를 찾을 수 없습니다."
        alert
      />
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
