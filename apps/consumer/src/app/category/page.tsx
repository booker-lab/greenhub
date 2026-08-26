'use client';

import type { Category, ColorOption, Product, SaleRoundItem, SaleType, SalesMode } from '@greenhub/shared';
import { normalizeSalesMode } from '@greenhub/shared';
import {
  Box,
  Button,
  Container,
  Divider,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { doc, getDoc } from 'firebase/firestore';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import ProductCard from '@/components/ProductCard';
import { useProducts } from '@/hooks/useProducts';
import { type PublicSaleRound, useSaleRounds } from '@/hooks/useSaleRounds';
import { db } from '@/lib/firebase';

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

type StoreModeStatus = 'loading' | 'ready' | 'error';

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

    void getDoc(doc(db, 'stores', storeId))
      .then((snapshot) => {
        if (!active) return;
        if (!snapshot.exists()) throw new Error('스토어를 찾을 수 없습니다.');

        const value = snapshot.data()?.salesMode;
        if (value !== undefined && value !== 'legacy' && value !== 'round_direct') {
          throw new Error('판매 방식 정보가 올바르지 않습니다.');
        }
        setState({ storeId, salesMode: normalizeSalesMode(value), status: 'ready' });
      })
      .catch(() => {
        if (active) setState({ storeId, salesMode: 'legacy', status: 'error' });
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

function RoundProductCard({
  item,
  round,
  isPast,
}: {
  item: SaleRoundItem;
  round: PublicSaleRound;
  isPast: boolean;
}) {
  const href = `/products/${encodeURIComponent(item.productId)}?round=${encodeURIComponent(round.id)}`;

  return (
    <Box
      component={Link}
      href={href}
      aria-label={`${isPast ? '지난 회차' : '이번 주 회차'} ${item.productNameSnapshot}`}
      style={{
        display: 'block',
        overflow: 'hidden',
        color: 'inherit',
        textDecoration: 'none',
        border: 'var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <Box
        style={{
          position: 'relative',
          aspectRatio: '4/5',
          overflow: 'hidden',
          background: 'var(--color-border)',
        }}
      >
        <Image
          fill
          src={item.productImageUrlSnapshot ?? '/icons/icon-192x192.png'}
          alt={item.productNameSnapshot}
          sizes="(max-width: 600px) 50vw, 33vw"
          style={{ objectFit: 'cover' }}
        />
      </Box>
      <Box p="xs">
        <Text size="xs" fw={700} c="var(--color-primary)" mb={4}>
          {isPast ? '지난 회차' : '이번 주 회차'}
        </Text>
        <Text size="sm" fw={500} c="var(--color-text)" lineClamp={2}>
          {item.productNameSnapshot}
        </Text>
        <Text size="xs" c="var(--color-text-disabled)" mt={6}>
          회차 가격
        </Text>
        <Text size="sm" fw={700} c="var(--color-text-secondary)">
          {item.roundPrice.toLocaleString()}원
        </Text>
      </Box>
    </Box>
  );
}

function RoundDirectCategory({
  products,
  currentRound,
  pastRounds,
  loading,
  error,
  refetch,
}: ReturnType<typeof useSaleRounds> & { products: Product[] }) {
  if (loading) {
    return (
      <Stack gap="md" aria-label="판매 회차 불러오는 중">
        <Skeleton height={72} radius="md" />
        <SimpleGrid cols={2} spacing="sm">
          {SKELETON_KEYS.map((key) => (
            <Skeleton key={key} height={260} radius="md" />
          ))}
        </SimpleGrid>
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack align="center" py={48} gap="sm" role="alert">
        <Text size="sm" c="var(--color-text-secondary)">
          판매 회차를 불러오지 못했습니다.
        </Text>
        <Button variant="light" onClick={refetch}>
          다시 시도
        </Button>
      </Stack>
    );
  }

  const productById = new Map(products.map((product) => [product.id, product]));
  const currentItems = currentRound ? visibleOrchidItems(currentRound, productById) : [];
  const pastRoundItems = pastRounds
    .map((round) => ({ round, items: visibleOrchidItems(round, productById) }))
    .filter(({ items }) => items.length > 0);

  if (currentItems.length === 0 && pastRoundItems.length === 0) {
    return (
      <Stack align="center" py={64}>
        <Text size="xl">🌱</Text>
        <Text size="sm" c="var(--color-text-disabled)">
          현재 또는 지난 판매 회차에 판매 중인 호접란이 없습니다.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="xl">
      <Box component="section" aria-labelledby="current-category-round">
        <Title
          id="current-category-round"
          order={4}
          mb="md"
          style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-bold)' }}
        >
          이번 주 회차
        </Title>
        {currentRound && currentItems.length > 0 ? (
          <Stack gap="sm">
            <Text size="sm" fw={700} c="var(--color-text-secondary)">
              {currentRound.name}
              {currentRound.status === 'CLOSED' ? ' · 주문 마감' : ''}
            </Text>
            <SimpleGrid cols={2} spacing="sm">
              {currentItems.map((item) => (
                <RoundProductCard key={item.id} item={item} round={currentRound} isPast={false} />
              ))}
            </SimpleGrid>
          </Stack>
        ) : (
          <Text size="sm" c="var(--color-text-disabled)" py="md">
            현재 회차에 판매 중인 호접란이 없습니다.
          </Text>
        )}
      </Box>

      <Divider />

      <Box component="section" aria-labelledby="past-category-round">
        <Title
          id="past-category-round"
          order={4}
          mb="md"
          style={{ color: 'var(--color-text)', fontWeight: 'var(--fw-bold)' }}
        >
          지난 회차
        </Title>
        {pastRoundItems.length > 0 ? (
          <Stack gap="xl">
            {pastRoundItems.map(({ round, items }) => (
              <Box key={round.id}>
                <Text size="sm" fw={700} c="var(--color-text-secondary)" mb="sm">
                  {round.name}
                </Text>
                <SimpleGrid cols={2} spacing="sm">
                  {items.map((item) => (
                    <RoundProductCard key={item.id} item={item} round={round} isPast />
                  ))}
                </SimpleGrid>
              </Box>
            ))}
          </Stack>
        ) : (
          <Text size="sm" c="var(--color-text-disabled)" py="md">
            지난 회차에 공개된 호접란이 없습니다.
          </Text>
        )}
      </Box>
    </Stack>
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
}: {
  selectedTab: number;
  setSelectedTab: (index: number) => void;
  selectedColors: ColorOption[];
  toggleColor: (color: ColorOption) => void;
  products: Product[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <>
      <Box pb="sm" style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
        <Group gap={0} wrap="nowrap">
          {TABS.map((tab, index) => {
            const isActive = selectedTab === index;
            return (
              <UnstyledButton
                key={tab.label}
                onClick={() => setSelectedTab(index)}
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
              </UnstyledButton>
            );
          })}
        </Group>
        <Divider />
      </Box>

      <Box py="sm" mb="sm" style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
        <Group gap={12} wrap="nowrap">
          {COLOR_CHIPS.map((chip) => {
            const isActive = selectedColors.includes(chip.value);
            return (
              <UnstyledButton
                key={chip.value}
                onClick={() => toggleColor(chip.value)}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <Box
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
                <Text
                  size="sm"
                  c={isActive ? 'var(--color-text)' : 'var(--color-text-disabled)'}
                  fw={isActive ? 700 : 500}
                >
                  {chip.label}
                </Text>
              </UnstyledButton>
            );
          })}
        </Group>
      </Box>

      <Divider mb="md" />

      {loading && (
        <SimpleGrid cols={2} spacing="sm">
          {SKELETON_KEYS.map((key) => (
            <Skeleton key={key} height={260} radius="md" />
          ))}
        </SimpleGrid>
      )}
      {!loading && error && (
        <Text ta="center" py={48} c="var(--color-text-disabled)" size="sm">
          {error}
        </Text>
      )}
      {!loading && !error && products.length === 0 && (
        <Stack align="center" py={64}>
          <Text size="xl">🌱</Text>
          <Text size="sm" c="var(--color-text-disabled)">
            해당 카테고리 상품이 없습니다.
          </Text>
        </Stack>
      )}
      {!loading && products.length > 0 && (
        <>
          <Text size="sm" c="var(--color-text-disabled)" fw={500} mb="sm">
            {products.length}개 상품
          </Text>
          <SimpleGrid cols={2} spacing="sm">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </SimpleGrid>
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
  const { products, loading, error } = useProducts(
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
    />
  );
  if (storeMode.status === 'loading') {
    content = (
      <SimpleGrid cols={2} spacing="sm" aria-label="판매 정보 불러오는 중">
        {SKELETON_KEYS.map((key) => (
          <Skeleton key={key} height={260} radius="md" />
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
    content = <RoundDirectCategory products={products} {...saleRounds} />;
  }

  return (
    <Container size="sm" pb={96}>
      <Box px="md" pt="lg" pb="md">
        <Title order={3} style={{ fontWeight: 'var(--fw-bold)', color: 'var(--color-text)' }}>
          상품
        </Title>
      </Box>
      <Box px="md">{content}</Box>
    </Container>
  );
}
