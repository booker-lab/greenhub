'use client';

import type { SettlementStatus } from '@greenhub/shared';
import { useState } from 'react';
import { apiJson } from '@/lib/api';
import { runAdminCommand, useAdminList, withQuery } from './useAdmin.list';
import type { AdminCommandOutcome } from './useAdmin.outcome';
import {
  ADMIN_SETTLEMENT_PAGE_SIZE,
  type AdminSettlementPage,
  appendSettlements,
  readAdminSettlementPage,
  readAdminSettlementsSummary,
} from './useAdmin.settlements.read';
import type { AdminSettlement, AdminSettlementsSummary } from './useAdmin.types';

export interface AdminSettlementFilters {
  storeId?: string;
  status?: SettlementStatus;
  from?: string;
  to?: string;
}

/** 첫 페이지 뒤에 더 불러온 행. base가 지금 첫 페이지와 다르면(조건 변경·재조회) 버린다. */
interface MoreState {
  base: AdminSettlementPage | null;
  settlements: AdminSettlement[];
  hasMore: boolean;
  nextCursor: string | null;
}

const NO_MORE: MoreState = { base: null, settlements: [], hasMore: false, nextCursor: null };

/**
 * 관리자 정산 — 첫 페이지·합계는 공통 목록 훅(최신 응답만 반영)으로 받고, "더 보기"는 같은 조건으로 이어 받는다.
 * 합계는 목록 페이지와 무관하게 같은 조건 전체를 서버가 계산한다(결정 ⑦).
 */
export function useAdminSettlements(filters: AdminSettlementFilters = {}) {
  const query = {
    storeId: filters.storeId,
    status: filters.status,
    from: filters.from,
    to: filters.to,
  };
  const deps = [filters.storeId, filters.status, filters.from, filters.to];

  const first = useAdminList<AdminSettlementPage>(
    () => withQuery('/admin/settlements', { ...query, limit: String(ADMIN_SETTLEMENT_PAGE_SIZE) }),
    (data) => [readAdminSettlementPage(data)],
    '정산 목록',
    deps,
  );
  const totals = useAdminList<AdminSettlementsSummary>(
    () => withQuery('/admin/settlements/summary', query),
    (data) => [readAdminSettlementsSummary(data)],
    '정산 합계',
    deps,
  );

  const firstPage = first.items[0] ?? null;
  const [more, setMore] = useState<MoreState>(NO_MORE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');
  const current = more.base !== null && more.base === firstPage ? more : null;

  const settlements = current
    ? appendSettlements(firstPage?.settlements ?? [], current.settlements)
    : (firstPage?.settlements ?? []);
  const hasMore = current ? current.hasMore : (firstPage?.hasMore ?? false);
  const nextCursor = current ? current.nextCursor : (firstPage?.nextCursor ?? null);

  const loadMore = async () => {
    const base = firstPage;
    if (!base || !nextCursor || !first.token || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const page = readAdminSettlementPage(
        await apiJson(
          withQuery('/admin/settlements', {
            ...query,
            limit: String(ADMIN_SETTLEMENT_PAGE_SIZE),
            cursor: nextCursor,
          }),
          first.token,
        ),
      );
      setMore((prev) => ({
        base,
        settlements: [...(prev.base === base ? prev.settlements : []), ...page.settlements],
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      }));
    } catch {
      setLoadMoreError('정산을 더 불러오지 못했습니다. 다시 눌러 주세요.');
    } finally {
      setLoadingMore(false);
    }
  };

  // 지급 뒤에는 첫 페이지와 합계를 함께 다시 읽는다(더 불러온 행은 첫 페이지가 바뀌면 접힌다).
  const reload = async (): Promise<string | null> => {
    const [listError, totalsError] = await Promise.all([first.reload(), totals.reload()]);
    return listError ?? totalsError;
  };

  const markAsPaid = async (settlementId: string): Promise<AdminCommandOutcome> => {
    return runAdminCommand(
      first.token,
      `/admin/settlements/${settlementId}/pay`,
      { method: 'PATCH' },
      reload,
    );
  };

  return {
    settlements,
    loading: first.loading,
    error: first.error,
    summary: totals.items[0] ?? null,
    summaryLoading: totals.loading,
    summaryError: totals.error,
    reload,
    markAsPaid,
    hasMore,
    loadMore,
    loadingMore,
    loadMoreError,
  };
}
