'use client';

import type { SalesMode } from '@greenhub/shared';
import { apiJson } from '@/lib/api';
import { readActiveDeliveryCount } from './useAdmin.driverSuspend';
import {
  pick,
  runAdminCommand,
  runAdminCommandWithBody,
  useAdminList,
  withQuery,
} from './useAdmin.list';
import type { AdminCommandOutcome } from './useAdmin.outcome';
import { useAdminPagedList } from './useAdmin.paged';
import type { AdminDriver, AdminReconciliation, AdminStore, AdminUser } from './useAdmin.types';

// ── Stores ───────────────────────────────────────────────────────

/** 판매 방식 전환 요청(PATCH /admin/stores/:storeId/sales-mode). 빈 사유는 보내지 않는다. */
export function buildSalesModeRequest(
  storeId: string,
  salesMode: SalesMode,
  reason?: string,
): { path: string; init: { method: 'PATCH'; body: string } } {
  const trimmed = reason?.trim();
  return {
    path: `/admin/stores/${encodeURIComponent(storeId)}/sales-mode`,
    init: {
      method: 'PATCH',
      body: JSON.stringify({ salesMode, ...(trimmed ? { reason: trimmed } : {}) }),
    },
  };
}

export function useAdminStores() {
  const {
    items: stores,
    loading,
    error,
    reload,
    token,
  } = useAdminList<AdminStore>(() => '/admin/stores', pick<AdminStore>('stores'), '판매자 목록');

  const setCommission = async (storeId: string, rate: number): Promise<AdminCommandOutcome> => {
    return runAdminCommand(
      token,
      `/admin/stores/${storeId}/commission`,
      {
        method: 'PATCH',
        body: JSON.stringify({ rate }),
      },
      reload,
    );
  };

  // 판매 방식 전환. 같은 값이면 서버가 바꾸지 않고 200을 준다.
  // 회차 판매 → 예전 방식은 끝나지 않은 회차가 있으면 서버가 409와 사유를 돌려준다(rejected의 message로 보존).
  const setSalesMode = async (
    storeId: string,
    salesMode: SalesMode,
    reason?: string,
  ): Promise<AdminCommandOutcome> => {
    const request = buildSalesModeRequest(storeId, salesMode, reason);
    return runAdminCommand(token, request.path, request.init, reload);
  };

  // 치우기 — 기록 가드 차단(400) 사유를 UI에 그대로 안내해야 하므로
  // outcome boolean 축약 대신 ApiError를 직접 전파한다.
  // command 2xx 확인 뒤 reload 실패는 reconciliation으로 반환한다 (실패로 되돌리지 않음).
  // 주문·정산 기록이 있는 판매자는 서버가 412로 가게 ID 앞 8자리 확인을 요구한다.
  const archiveStore = async (
    storeId: string,
    confirmStoreIdPrefix?: string,
  ): Promise<AdminReconciliation> => {
    if (!token) throw new Error('인증 토큰이 없습니다. 다시 로그인해 주세요.');
    await apiJson(`/admin/stores/${storeId}/archive`, token, {
      method: 'PATCH',
      ...(confirmStoreIdPrefix === undefined
        ? {}
        : { body: JSON.stringify({ confirmStoreIdPrefix }) }),
    });
    const readError = await reload();
    if (readError === null) return { reconciled: true, readError: null };
    return { reconciled: false, readError };
  };

  const restoreStore = async (storeId: string): Promise<AdminReconciliation> => {
    if (!token) throw new Error('인증 토큰이 없습니다. 다시 로그인해 주세요.');
    await apiJson(`/admin/stores/${storeId}/restore`, token, { method: 'PATCH' });
    const readError = await reload();
    if (readError === null) return { reconciled: true, readError: null };
    return { reconciled: false, readError };
  };

  return {
    stores,
    loading,
    error,
    reload,
    setCommission,
    setSalesMode,
    archiveStore,
    restoreStore,
  };
}

// ── Users ────────────────────────────────────────────────────────

export function useAdminUsers() {
  const {
    items: users,
    loading,
    error,
    reload,
    token,
  } = useAdminList<AdminUser>(() => '/admin/users', pick<AdminUser>('users'), '사용자 목록');

  const toggleSuspend = async (
    userId: string,
    suspended: boolean,
    reason?: string,
  ): Promise<AdminCommandOutcome> => {
    return runAdminCommand(
      token,
      `/admin/users/${userId}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ suspended, ...(reason ? { reason } : {}) }),
      },
      reload,
    );
  };

  return { users, loading, error, reload, toggleSuspend };
}

// ── Drivers ──────────────────────────────────────────────────────

export function useAdminDrivers() {
  const {
    items: drivers,
    hasMore,
    loading,
    loadingMore,
    error,
    moreError,
    reload,
    loadMore,
    token,
  } = useAdminPagedList<AdminDriver>(
    (cursor) => withQuery('/admin/drivers', { cursor: cursor ?? undefined }),
    'drivers',
    '드라이버 목록',
  );

  const approve = async (userId: string): Promise<AdminCommandOutcome> => {
    return runAdminCommand(token, `/admin/drivers/${userId}/approve`, { method: 'PATCH' }, reload);
  };

  // 정지 응답의 배송 중 배정 주문 수(세지 못했으면 null)를 함께 돌려준다. 정지 해제·실패는 0.
  const toggleSuspend = async (
    userId: string,
    suspended: boolean,
    reason?: string,
  ): Promise<AdminCommandOutcome & { activeDeliveryCount: number | null }> => {
    const { outcome, body } = await runAdminCommandWithBody(
      token,
      `/admin/drivers/${userId}/suspend`,
      {
        method: 'PATCH',
        body: JSON.stringify({ suspended, ...(reason ? { reason } : {}) }),
      },
      reload,
    );
    return { ...outcome, activeDeliveryCount: readActiveDeliveryCount(body) };
  };

  return {
    drivers,
    hasMore,
    loading,
    loadingMore,
    error,
    moreError,
    reload,
    loadMore,
    approve,
    toggleSuspend,
  };
}
