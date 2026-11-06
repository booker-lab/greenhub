'use client';

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
import { useOrderSummary } from '@/hooks/useOrderSummary';
import { ACTIVE_SELLER_ORDERS_QUERY, useOrders } from '@/hooks/useOrders';
import { useStoreOperationIssues } from '@/hooks/useStoreOperationIssues';
import { useStoreProducts } from '@/hooks/useStoreProducts';
import { areStoreProductCountsTrustworthy } from '@/hooks/useStoreProducts.recovery';

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const storeId = session?.user.storeId ?? null;
  const firebaseReady = useFirebaseReady();
  // 홈은 진행 중 주문만 받고, 완료·취소는 건수만 받는다(끝난 주문 목록을 내려받지 않는다).
  const { orders, loading, error, groupCounts } = useOrders(storeId, ACTIVE_SELLER_ORDERS_QUERY);
  const archivedCounts = useOrderSummary(storeId);
  const statusCounts = {
    ...groupCounts,
    DONE: archivedCounts?.DONE ?? null,
    CANCELLED: archivedCounts?.CANCELLED ?? null,
  };
  const {
    products,
    loading: productsLoading,
    error: productsError,
    retry: retryProducts,
    hasLoaded: productsHasLoaded,
  } = useStoreProducts(storeId);
  const {
    summary,
    loading: summaryLoading,
    error: summaryError,
    hasLoaded: summaryHasLoaded,
    retry: retrySummary,
  } = useDashboardSummary();
  const { openIssues } = useStoreOperationIssues();
  const productsTrustworthy = areStoreProductCountsTrustworthy({
    hasLoaded: productsHasLoaded,
    loading: productsLoading,
    error: productsError,
  });

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
        right={
          <ConnectionStatus
            loading={loading}
            error={error}
            firebaseReady={firebaseReady}
            source="api"
          />
        }
      />

      {/* ① 외형 유지(UI 교체 P4): Mantine Container size sm(최대 720px, 좌우 16px)·py md, Stack gap md. */}
      <div className="mx-auto max-w-[720px] px-4 py-4">
        <div className="flex flex-col items-stretch justify-start gap-4">
          <TodayTasksCard
            orders={orders}
            products={products}
            productsError={productsError}
            productsTrustworthy={productsTrustworthy}
            openIssueCount={openIssues.length}
          />
          <OrderStatusCard groupCounts={statusCounts} />
          <SettlementCard
            summary={summary}
            loading={summaryLoading}
            error={summaryError}
            hasLoaded={summaryHasLoaded}
            onRetry={retrySummary}
          />
          <ProductStatusCard
            products={products}
            loading={productsLoading}
            error={productsError}
            hasLoaded={productsHasLoaded}
            onRetry={retryProducts}
          />
        </div>
      </div>
    </PageShell>
  );
}
