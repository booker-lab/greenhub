'use client';

import { Box, Button, Container, Group, Stack, Text, Title } from '@mantine/core';
import Link from 'next/link';
import { notFound, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo } from 'react';
import ResilientImage, { PRODUCT_IMAGE_FALLBACK } from '@/components/ResilientImage';
import { readCreatedAtMillis, useOrders } from '@/hooks/useOrders';
import { isFeatureOn } from '@/lib/features';
import { collectPurchaseHistory } from '@/lib/purchase-history';

// 구매한 꽃(purchase-history, 벤치마킹 비교 기능). 내 주문 내역을 상품별로 모아 보여 준다.
// 기능이 꺼져 있으면 없는 화면이다.
export default function PurchaseHistoryPage() {
  if (!isFeatureOn('purchase-history')) notFound();
  return <PurchaseHistoryContent />;
}

const KST_DAY = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Seoul',
});
const KST_DAY_WITH_YEAR = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Seoul',
});
const KST_YEAR = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', timeZone: 'Asia/Seoul' });

function formatPurchaseDay(millis: number) {
  const date = new Date(millis);
  return KST_YEAR.format(date) === KST_YEAR.format(new Date())
    ? KST_DAY.format(date)
    : KST_DAY_WITH_YEAR.format(date);
}

const mutedTextStyle = {
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--font-size-sm)',
} as const;

function PurchaseHistoryContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { orders, loading, error, refetch } = useOrders();
  const entries = useMemo(() => collectPurchaseHistory(orders, readCreatedAtMillis), [orders]);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  if (status === 'loading' || !session) {
    return (
      <Box py={60} ta="center">
        <Text style={{ color: 'var(--color-text-disabled)' }}>로딩 중...</Text>
      </Box>
    );
  }

  return (
    <Container size="sm" px="md" pt="lg" pb={100}>
      <Title order={1} style={{ fontSize: 22, fontWeight: 800 }}>
        구매한 꽃
      </Title>
      <Text mt={4} mb="md" style={mutedTextStyle}>
        지금까지 산 꽃을 최근에 산 순서로 모았어요. 취소·환불됐거나 결제가 끝나지 않은 주문은 빼요.
      </Text>

      {loading && entries.length === 0 && (
        <Text
          ta="center"
          py="lg"
          style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--font-size-sm)' }}
        >
          불러오는 중...
        </Text>
      )}

      {error && (
        <Group justify="space-between" align="center" mb="sm">
          <Text style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}>
            주문 내역을 불러오지 못했습니다.
          </Text>
          <Button variant="default" size="xs" radius="xl" onClick={refetch}>
            다시 시도
          </Button>
        </Group>
      )}

      {!loading && !error && entries.length === 0 && (
        <Stack align="center" py={40} gap="md">
          <Text style={mutedTextStyle}>아직 구매한 꽃이 없어요.</Text>
          <Button component={Link} href="/" radius="xl">
            이번 회차 보러 가기
          </Button>
        </Stack>
      )}

      {entries.length > 0 && (
        <Stack gap="sm" data-testid="purchase-history-list">
          {entries.map((entry) => (
            <Group
              key={entry.productId}
              gap={12}
              wrap="nowrap"
              align="center"
              p="sm"
              style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}
            >
              <Box
                style={{
                  position: 'relative',
                  width: 56,
                  height: 56,
                  flexShrink: 0,
                  overflow: 'hidden',
                  borderRadius: 12,
                  background: 'var(--color-surface-muted)',
                }}
              >
                <ResilientImage
                  fill
                  src={entry.productImageUrl ?? PRODUCT_IMAGE_FALLBACK}
                  fallbackSrc={PRODUCT_IMAGE_FALLBACK}
                  alt=""
                  sizes="56px"
                  style={{ objectFit: 'cover' }}
                />
              </Box>
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Text
                  component={Link}
                  href={`/products/${encodeURIComponent(entry.productId)}`}
                  lineClamp={1}
                  style={{
                    color: 'var(--color-text)',
                    fontSize: 'var(--font-size-md)',
                    fontWeight: 'var(--fw-extrabold)',
                    textDecoration: 'none',
                  }}
                >
                  {entry.productName}
                </Text>
                <Text mt={2} style={mutedTextStyle}>
                  {entry.lastPurchasedAt !== null
                    ? `마지막 구매 ${formatPurchaseDay(entry.lastPurchasedAt)} · `
                    : ''}
                  {entry.orderCount}번 주문
                </Text>
              </Box>
            </Group>
          ))}
        </Stack>
      )}
    </Container>
  );
}
