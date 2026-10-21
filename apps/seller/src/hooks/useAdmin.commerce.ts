'use client';

import type { AdminCommandOutcome } from './useAdmin.outcome';
import { runAdminCommandWithBody, withQuery } from './useAdmin.list';
import { useAdminPagedList } from './useAdmin.paged';
import { type RefundRecovery, readRefundRecovery } from './useAdmin.refund';
import type { AdminOrder } from './useAdmin.types';

// ── Orders ───────────────────────────────────────────────────────

export function useAdminOrders(filters?: { storeId?: string; status?: string }) {
  const {
    items: orders,
    hasMore,
    loading,
    loadingMore,
    error,
    moreError,
    reload,
    loadMore,
    token,
  } = useAdminPagedList<AdminOrder>(
    (cursor) =>
      withQuery('/admin/orders', {
        storeId: filters?.storeId,
        status: filters?.status,
        cursor: cursor ?? undefined,
      }),
    'orders',
    '주문 목록',
    [filters?.storeId, filters?.status],
  );

  // 지급 완료 정산의 주문이면 응답의 회수 정보(recovery)를 함께 돌려준다(결정 ④).
  const forceRefund = async (
    orderId: string,
    reason?: string,
  ): Promise<AdminCommandOutcome & { recovery: RefundRecovery | null }> => {
    const { outcome, body } = await runAdminCommandWithBody(
      token,
      `/admin/orders/${orderId}/refund`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      },
      reload,
    );
    return { ...outcome, recovery: readRefundRecovery(body) };
  };

  return {
    orders,
    hasMore,
    loading,
    loadingMore,
    error,
    moreError,
    reload,
    loadMore,
    forceRefund,
  };
}

// 정산 훅은 useAdmin.settlements(더 보기·서버 합계)가 소유한다.
