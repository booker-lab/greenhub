'use client';

import { apiJson } from '@/lib/api';
import type { AdminCommandOutcome } from './useAdmin.outcome';
import { pick, runAdminCommand, useAdminList, withQuery } from './useAdmin.list';
import { useAdminPagedList } from './useAdmin.paged';
import type { AdminDriver, AdminReconciliation, AdminStore, AdminUser } from './useAdmin.types';

// ── Stores ───────────────────────────────────────────────────────

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

  // 치우기 — 기록 가드 차단(400) 사유를 UI에 그대로 안내해야 하므로
  // outcome boolean 축약 대신 ApiError를 직접 전파한다.
  // command 2xx 확인 뒤 reload 실패는 reconciliation으로 반환한다 (실패로 되돌리지 않음).
  const archiveStore = async (storeId: string): Promise<AdminReconciliation> => {
    if (!token) throw new Error('인증 토큰이 없습니다. 다시 로그인해 주세요.');
    await apiJson(`/admin/stores/${storeId}/archive`, token, { method: 'PATCH' });
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

  return { stores, loading, error, reload, setCommission, archiveStore, restoreStore };
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

  const toggleSuspend = async (
    userId: string,
    suspended: boolean,
    reason?: string,
  ): Promise<AdminCommandOutcome> => {
    return runAdminCommand(
      token,
      `/admin/drivers/${userId}/suspend`,
      {
        method: 'PATCH',
        body: JSON.stringify({ suspended, ...(reason ? { reason } : {}) }),
      },
      reload,
    );
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
