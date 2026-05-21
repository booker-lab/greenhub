'use client';

import { Container, Stack } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect } from 'react';
import { OrderStatusCard, ProductStatusCard, SettlementCard } from '@/app/_components/StatusCards';
import { TodayTasksCard } from '@/app/_components/TodayTasksCard';
import { useFirebaseReady } from '@/app/providers';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { LoadingState } from '@/components/StateViews';
import { useDashboardSummary } from '@/hooks/useDashboardSummary';
import { useOrders } from '@/hooks/useOrders';
import { useStoreProducts } from '@/hooks/useStoreProducts';

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
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
  }, [status, router]);

  if (status === 'loading' || !session) {
    return <LoadingState fullPage />;
  }

  return (
    <PageShell>
      <PageHeader
        title="홈"
        right={<ConnectionStatus loading={loading} error={error} firebaseReady={firebaseReady} />}
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
