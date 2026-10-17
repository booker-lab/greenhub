'use client';

import { Box, Button, Container, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useState } from 'react';
import { BenchmarkCardProvider, CardDiscount, CardMeta } from '@/components/benchmark/CardExtras';
import { useHomeCardContext } from '@/components/HomeProductList';
import ProductTopBar from '@/components/ProductTopBar';
import { useProducts } from '@/hooks/useProducts';
import { useSaleRounds } from '@/hooks/useSaleRounds';
import { isFeatureOn } from '@/lib/features';

// 판매자 화면(seller-store, 벤치마킹 비교 기능): 소개·재배 이야기·별점 요약·이번 회차 상품·공유.
export default function StorePage() {
  if (!isFeatureOn('seller-store')) notFound();
  return <StoreContent />;
}

function StoreContent() {
  const params = useParams<{ storeId: string }>();
  const storeId = typeof params.storeId === 'string' ? params.storeId : null;
  const { products } = useProducts();
  const storeProducts = products.filter((p) => p.storeId === storeId);
  const card = useHomeCardContext(storeId, storeProducts);
  const profile = card.storeProfile;
  const { currentRound } = useSaleRounds(storeId);
  const [shared, setShared] = useState<string | null>(null);

  const reviewValues = Object.values(card.reviewStats);
  const reviewCount = reviewValues.reduce((sum, r) => sum + r.count, 0);
  const reviewAverage =
    reviewCount > 0
      ? Math.round((reviewValues.reduce((sum, r) => sum + r.average * r.count, 0) / reviewCount) * 10) / 10
      : 0;
  const items = currentRound?.items.filter((item) => item.status !== 'HIDDEN') ?? [];

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: profile?.name ?? '그린러브', url });
      else {
        await navigator.clipboard.writeText(url);
        setShared('주소를 복사했어요');
      }
    } catch {
      // 공유 창을 닫으면 아무것도 하지 않는다.
    }
  }

  return (
    <Container size="sm" p={0} pb={100}>
      <ProductTopBar />
      <Stack gap="lg" px="md" style={{ paddingTop: 'calc(68px + env(safe-area-inset-top))' }}>
        <Box>
          <Text size="sm" fw={800} c="var(--color-primary-dark)">
            {[profile?.region, profile?.sinceYear ? `${profile.sinceYear}년부터` : null].filter(Boolean).join(' · ')}
          </Text>
          <Title order={1} style={{ fontSize: 22, fontWeight: 800 }}>
            {profile?.name ?? '판매자'}
          </Title>
          {profile?.intro && <Text mt={4}>{profile.intro}</Text>}
          {isFeatureOn('reviews') && reviewCount > 0 && (
            <Text size="sm" fw={700} mt={6}>
              <span aria-hidden style={{ color: '#F5A524' }}>
                ★
              </span>{' '}
              {reviewAverage.toFixed(1)} · 후기 {reviewCount}
            </Text>
          )}
          <Button variant="outline" radius="xl" mt="sm" onClick={() => void share()}>
            판매자 공유하기
          </Button>
          {shared && (
            <Text role="status" size="sm" mt={4} c="var(--color-primary-dark)">
              {shared}
            </Text>
          )}
        </Box>

        {profile?.story && (
          <Box p="md" style={{ background: 'var(--color-surface-muted)', borderRadius: 'var(--radius)' }}>
            <Text fw={800} mb={6}>
              어떻게 고르나요
            </Text>
            <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
              {profile.story}
            </Text>
          </Box>
        )}

        <Box>
          <Text fw={800} mb="sm">
            {currentRound ? `${currentRound.name} 상품` : '이번 회차 상품'}
          </Text>
          {items.length === 0 ? (
            <Text size="sm" c="var(--color-text-secondary)">
              지금 열린 회차 상품이 없어요.
            </Text>
          ) : (
            <BenchmarkCardProvider value={card}>
              <SimpleGrid cols={2} spacing={12}>
                {items.map((item) => (
                  <Box
                    key={item.id}
                    component={Link}
                    href={`/products/${encodeURIComponent(item.productId)}?round=${encodeURIComponent(item.roundId)}`}
                    p="sm"
                    style={{ border: 'var(--border)', borderRadius: 'var(--radius)', color: 'inherit', textDecoration: 'none' }}
                  >
                    <Text size="sm" fw={700} lineClamp={2}>
                      {item.productNameSnapshot}
                    </Text>
                    <Text size="md" fw={800} mt={2}>
                      {item.roundPrice.toLocaleString()}원
                      <CardDiscount item={item} />
                    </Text>
                    <CardMeta item={item} isPast={false} />
                  </Box>
                ))}
              </SimpleGrid>
            </BenchmarkCardProvider>
          )}
        </Box>
      </Stack>
    </Container>
  );
}
