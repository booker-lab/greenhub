'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useFirebaseReady } from '@/app/providers';
import { useOrders } from '@/hooks/useOrders';
import { useStoreProducts } from '@/hooks/useStoreProducts';
import { useDashboardSummary } from '@/hooks/useDashboardSummary';
import { Box, Container, Group, Stack, Text } from '@mantine/core';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/PageHeader';
import { LoadingState } from '@/components/StateViews';
import { TodayTasksCard } from '@/app/_components/TodayTasksCard';
import {
  OrderStatusCard,
  SettlementCard,
  ProductStatusCard,
} from '@/app/_components/StatusCards';

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const storeId = session?.user.storeId ?? null;
  const firebaseReady = useFirebaseReady();
  const { orders, loading, error, groupCounts } = useOrders(storeId);
  const { products } = useStoreProducts(storeId);
  const { summary, loading: summaryLoading, error: summaryError } = useDashboardSummary();

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') { router.replace('/login'); return; }
  }, [status, session, router]);

  if (status === 'loading' || !session) {
    return <LoadingState fullPage />;
  }

  const isConnecting = loading || !firebaseReady;
  const dotColor = isConnecting
    ? 'var(--color-caution-border)'
    : error
      ? 'var(--color-danger)'
      : 'var(--color-primary)';
  const connLabel = isConnecting ? '연결 중' : error ? '연결 오류' : '실시간 연결';

  return (
    <PageShell>
      <PageHeader
        title="홈"
        right={
          <Group gap={6}>
            <Box
              style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: dotColor }}
            />
            <Text style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}>
              {connLabel}
            </Text>
          </Group>
        }
      />

      <Container size="sm" py="md">
        <Stack gap="md">
          <TodayTasksCard orders={orders} products={products} />
          <OrderStatusCard groupCounts={groupCounts} />
          <SettlementCard summary={summary} loading={summaryLoading} error={summaryError} />
          <ProductStatusCard products={products} />
        </Stack>
      </Container>
    </PageShell>
  );
}
