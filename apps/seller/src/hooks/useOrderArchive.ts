'use client';

import type { Order } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJson } from '@/lib/api';
import {
  buildArchivedOrdersPath,
  buildSellerOrdersScopeKey,
  parseArchivedOrdersPage,
} from './useOrders.recovery';

interface ArchiveState {
  scope: string;
  orders: Order[];
  hasMore: boolean;
  nextCursor: string | null;
  loaded: boolean;
}

const emptyArchive = (scope: string): ArchiveState => ({
  scope,
  orders: [],
  hasMore: false,
  nextCursor: null,
  loaded: false,
});

export interface UseOrderArchiveResult {
  orders: Order[];
  /** 첫 페이지를 받았는지. 받기 전에는 완료·취소 건수를 확정하지 않는다. */
  loaded: boolean;
  /** 더 받을 끝난 주문이 남았는지. 남았으면 화면의 건수는 지금까지 받은 것만이다. */
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadMore: () => void;
  /** 첫 페이지부터 다시 받는다. */
  refresh: () => void;
}

/**
 * 끝난 주문(완료·취소)을 최신순으로 50건씩 받는다. 주문이 쌓여도 한 번에 받는 양이 늘지 않게,
 * 완료·취소 탭을 처음 열 때(enabled) 첫 페이지만 받고 나머지는 '더 보기'로 이어 받는다.
 * 매장·로그인이 바뀌면 이전 목록을 버리고, 늦게 도착한 이전 응답은 무시한다.
 */
export function useOrderArchive(storeId: string | null, enabled: boolean): UseOrderArchiveResult {
  const { data: session } = useSession();
  const token = session?.user.accessToken ?? null;
  const scopeKey = buildSellerOrdersScopeKey(storeId, token, 'archive');
  const [state, setState] = useState<ArchiveState>(() => emptyArchive(scopeKey));
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const requestIdRef = useRef(0);
  const requestedScopeRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
    },
    [],
  );

  const load = useCallback(
    async (cursor: string | null) => {
      if (!storeId || !token) return;
      const myId = ++requestIdRef.current;
      setLoading(true);
      setFailure(null);
      try {
        const page = parseArchivedOrdersPage<Order>(
          await apiJson(buildArchivedOrdersPath(storeId, cursor), token),
        );
        if (requestIdRef.current !== myId) return;
        setState((prev) => ({
          scope: scopeKey,
          // 이어 받기는 같은 scope의 앞 목록 뒤에 붙이고, 첫 페이지는 목록을 바꾼다.
          orders:
            cursor && prev.scope === scopeKey ? [...prev.orders, ...page.orders] : page.orders,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          loaded: true,
        }));
      } catch (err: unknown) {
        if (requestIdRef.current !== myId) return;
        setFailure({
          scope: scopeKey,
          message: err instanceof Error ? err.message : '끝난 주문을 불러오지 못했습니다.',
        });
      } finally {
        if (requestIdRef.current === myId) setLoading(false);
      }
    },
    [storeId, token, scopeKey],
  );

  // 처음 필요해질 때 한 번만 첫 페이지를 받는다(실패해도 자동으로 되풀이하지 않고 다시 시도를 기다린다).
  useEffect(() => {
    if (!enabled || !storeId || !token || requestedScopeRef.current === scopeKey) return;
    requestedScopeRef.current = scopeKey;
    void load(null);
  }, [enabled, storeId, token, scopeKey, load]);

  const current = state.scope === scopeKey ? state : emptyArchive(scopeKey);

  const loadMore = useCallback(() => {
    if (loading || !current.nextCursor) return;
    void load(current.nextCursor);
  }, [loading, current.nextCursor, load]);

  const refresh = useCallback(() => {
    requestedScopeRef.current = scopeKey;
    void load(null);
  }, [scopeKey, load]);

  return {
    orders: current.orders,
    loaded: current.loaded,
    hasMore: current.hasMore,
    loading,
    error: failure?.scope === scopeKey ? failure.message : null,
    loadMore,
    refresh,
  };
}
