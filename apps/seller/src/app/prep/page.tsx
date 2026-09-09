'use client';

import { Alert, Box, Button, Container, Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { ChevronRight, RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useMemo } from 'react';
import { useFirebaseReady } from '@/app/providers';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { EmptyState, LoadingState } from '@/components/StateViews';
import { useOrders } from '@/hooks/useOrders';
import { useStoreProducts } from '@/hooks/useStoreProducts';
import { resolveStoreProductsView } from '@/hooks/useStoreProducts.recovery';
import { aggregatePrep, type PrepLine } from '@/lib/prep';

function PrepRow({ line, index, accent }: { line: PrepLine; index: number; accent?: boolean }) {
  return (
    <Group
      justify="space-between"
      wrap="nowrap"
      py={10}
      style={index > 0 ? { borderTop: '1px solid var(--color-border)' } : undefined}
    >
      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
        <Text
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text)',
            fontWeight: 'var(--fw-medium)',
          }}
        >
          {line.productName}
        </Text>
        {line.selectionLabel && (
          <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
            ({line.selectionLabel})
          </Text>
        )}
      </Group>
      <Text
        style={{
          fontSize: 'var(--font-size-md)',
          fontWeight: 'var(--fw-bold)',
          color: accent ? 'var(--color-danger)' : 'var(--color-text)',
          flexShrink: 0,
        }}
      >
        {line.quantity}개
      </Text>
    </Group>
  );
}

export default function PrepPage() {
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? null;
  const firebaseReady = useFirebaseReady();
  const { orders, loading, error } = useOrders(storeId);
  const {
    products,
    loading: productsLoading,
    error: productsError,
    retry: retryProducts,
    hasLoaded: productsHasLoaded,
  } = useStoreProducts(storeId);

  const { today, delayed } = useMemo(() => aggregatePrep(orders, products), [orders, products]);

  const productsView = resolveStoreProductsView({
    storeId,
    loading: productsLoading,
    error: productsError,
    productCount: products.length,
    hasLoaded: productsHasLoaded,
  });
  // 상품 첫 조회가 끝나기 전에는 준비 목록을 확정 0건처럼 표시하지 않는다.
  const isProductsConnecting = !!storeId && productsView === 'LOADING';
  const isConnecting = loading || isProductsConnecting || !firebaseReady;

  const todayLabel = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  const todayTotal = today.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <PageShell>
      <PageHeader
        title="준비 물량"
        right={
          <ConnectionStatus
            loading={loading}
            error={error}
            firebaseReady={firebaseReady}
            source="api"
          />
        }
      />

      <Container size="sm" px="md" py="md">
        {!!storeId && productsView === 'READ_FAILED' && !isConnecting && (
          <Alert color="red" title="상품 정보를 불러오지 못했습니다" role="alert" mb="md">
            <Stack gap="xs">
              <Text style={{ fontSize: 'var(--font-size-sm)' }}>
                준비 수량의 상품 이름이 &lsquo;상품 정보 없음&rsquo;으로 표시될 수 있습니다.
                수량 자체는 주문 기준으로 집계됩니다.
              </Text>
              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={<RefreshCcw size={14} />}
                onClick={retryProducts}
              >
                상품 다시 조회
              </Button>
            </Stack>
          </Alert>
        )}

        {!!storeId && productsView === 'STALE' && !isConnecting && (
          <Alert color="yellow" title="최신 상품 정보를 확인하지 못했습니다" role="alert" mb="md">
            <Stack gap="xs">
              <Text style={{ fontSize: 'var(--font-size-sm)' }}>
                이전 상품 이름으로 표시합니다. 준비 수량 자체는 주문 기준으로 집계됩니다.
              </Text>
              <Button
                size="xs"
                variant="light"
                color="yellow"
                leftSection={<RefreshCcw size={14} />}
                onClick={retryProducts}
              >
                상품 다시 조회
              </Button>
            </Stack>
          </Alert>
        )}

        {isConnecting && <LoadingState />}

        {!isConnecting && today.length === 0 && delayed.length === 0 && (
          <EmptyState text="오늘 준비할 물량이 없습니다" />
        )}

        {!isConnecting && (today.length > 0 || delayed.length > 0) && (
          <Stack gap="md">
            {today.length > 0 && (
              <Paper radius="lg" shadow="xs" p="md">
                <Text style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--fw-bold)' }}>
                  오늘 준비 물량 ({todayLabel})
                </Text>
                <Box mt="sm">
                  {today.map((line, i) => (
                    <PrepRow key={line.productId} line={line} index={i} />
                  ))}
                </Box>
                <Group
                  justify="flex-end"
                  pt={10}
                  style={{ borderTop: '1px solid var(--color-border)' }}
                >
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                      fontWeight: 'var(--fw-medium)',
                    }}
                  >
                    {today.length}개 상품 · 총 {todayTotal}개
                  </Text>
                </Group>
              </Paper>
            )}

            {delayed.length > 0 && (
              <Paper
                radius="lg"
                shadow="xs"
                p="md"
                style={{ border: '1px solid var(--color-danger)' }}
              >
                <Text
                  style={{
                    fontSize: 'var(--font-size-md)',
                    fontWeight: 'var(--fw-bold)',
                    color: 'var(--color-danger)',
                  }}
                >
                  🔴 발송 지연 (배송일 경과)
                </Text>
                <Box mt="sm">
                  {delayed.map((line, i) => (
                    <PrepRow key={line.productId} line={line} index={i} accent />
                  ))}
                </Box>
                <UnstyledButton
                  component={Link}
                  href="/orders?tab=ACTION_REQUIRED"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 2,
                    paddingTop: 10,
                    borderTop: '1px solid var(--color-border)',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    주문 관리에서 처리하기
                  </Text>
                  <ChevronRight size={14} color="var(--color-text-secondary)" />
                </UnstyledButton>
              </Paper>
            )}
          </Stack>
        )}
      </Container>
    </PageShell>
  );
}
