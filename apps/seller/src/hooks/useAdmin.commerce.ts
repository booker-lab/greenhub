'use client';

import type { AdminCommandOutcome } from './useAdmin.outcome';
import {
  pick,
  runAdminCommand,
  runAdminCommandWithBody,
  useAdminList,
  withQuery,
} from './useAdmin.list';
import { type RefundRecovery, readRefundRecovery } from './useAdmin.refund';
import type { AdminOrder, AdminSettlement } from './useAdmin.types';

// ── Orders ───────────────────────────────────────────────────────

export function useAdminOrders(filters?: { storeId?: string; status?: string }) {
  const {
    items: orders,
    loading,
    error,
    reload,
    token,
  } = useAdminList<AdminOrder>(
    () => withQuery('/admin/orders', { storeId: filters?.storeId, status: filters?.status }),
    pick<AdminOrder>('orders'),
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

  return { orders, loading, error, reload, forceRefund };
}

// ── Settlements ──────────────────────────────────────────────────

export function useAdminSettlements(filters?: { storeId?: string; from?: string; to?: string }) {
  const {
    items: settlements,
    loading,
    error,
    reload,
    token,
  } = useAdminList<AdminSettlement>(
    () =>
      withQuery('/admin/settlements', {
        storeId: filters?.storeId,
        from: filters?.from,
        to: filters?.to,
      }),
    pick<AdminSettlement>('settlements'),
    '정산 목록',
    [filters?.storeId, filters?.from, filters?.to],
  );

  const markAsPaid = async (settlementId: string): Promise<AdminCommandOutcome> => {
    return runAdminCommand(
      token,
      `/admin/settlements/${settlementId}/pay`,
      { method: 'PATCH' },
      reload,
    );
  };

  return { settlements, loading, error, reload, markAsPaid };
}
