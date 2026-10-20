'use client';

import type { AdminCommandOutcome } from './useAdmin.outcome';
import { pick, runAdminCommand, useAdminList, withQuery } from './useAdmin.list';
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

  const forceRefund = async (orderId: string, reason?: string): Promise<AdminCommandOutcome> => {
    return runAdminCommand(
      token,
      `/admin/orders/${orderId}/refund`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      },
      reload,
    );
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
