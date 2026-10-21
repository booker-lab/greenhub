'use client';

import type { PostDeliveryRefundReasonCode } from '@greenhub/shared';
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

  // 배송 후 환불(기한 없음) — 사유 코드·메모 필수. 지급 완료 정산이면 서버가 회수 대기로 표시한다.
  const postDeliveryRefund = async (
    orderId: string,
    reasonCode: PostDeliveryRefundReasonCode,
    memo: string,
  ): Promise<AdminCommandOutcome> => {
    return runAdminCommand(
      token,
      `/admin/orders/${orderId}/post-delivery-refund`,
      { method: 'POST', body: JSON.stringify({ reasonCode, memo }) },
      reload,
    );
  };

  return { orders, loading, error, reload, forceRefund, postDeliveryRefund };
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

  // 판매자에게서 돌려받을 돈을 계좌로 받은 뒤 "회수 완료"로 표시한다.
  const completeRecovery = async (settlementId: string): Promise<AdminCommandOutcome> => {
    return runAdminCommand(
      token,
      `/admin/settlements/${settlementId}/recovery-complete`,
      { method: 'PATCH' },
      reload,
    );
  };

  return { settlements, loading, error, reload, markAsPaid, completeRecovery };
}
