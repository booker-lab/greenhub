'use client';

import type { Order } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type OrderGroup, STATUS_GROUP_MAP } from '@/app/orders/_constants';
import { apiJson } from '@/lib/api';
import {
  buildSellerOrdersPath,
  buildSellerOrdersScopeKey,
  isSellerOrdersBackgroundRefresh,
  resolveSellerOrdersAuthState,
  SELLER_ORDERS_AUTH_ERROR,
  shouldIgnoreSellerOrdersResponse,
  shouldIgnoreSellerOrdersScopeResponse,
  shouldInvalidateSellerOrdersScope,
} from './useOrders.recovery';

export {
  buildSellerOrdersPath,
  buildSellerOrdersScopeKey,
  isSellerOrdersBackgroundRefresh,
  resolveSellerOrdersAuthState,
  SELLER_ORDERS_AUTH_ERROR,
  shouldIgnoreSellerOrdersResponse,
  shouldIgnoreSellerOrdersScopeResponse,
  shouldInvalidateSellerOrdersScope,
} from './useOrders.recovery';
export type { SellerOrdersAuthState } from './useOrders.recovery';
export { resolveSellerOrdersInitialView } from './useOrders.recovery';

interface UseOrdersResult {
  orders: Order[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  groupCounts: Record<OrderGroup, number>;
  refresh: () => void;
}

export function useOrders(storeId: string | null): UseOrdersResult {
  const { data: session, status: sessionStatus } = useSession();
  const token = session?.user.accessToken;
  const scopeKey = buildSellerOrdersScopeKey(storeId, token);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [scope, setScope] = useState(scopeKey);
  const scopeRef = useRef(scopeKey);
  const requestIdRef = useRef(0);
  const hasDataRef = useRef(false);

  // Cross-scope reuse 금지: store/token이 바뀌면 이전 scope의
  // orders/count/badge(hasData)/error authority를 렌더 단계에서 동기적으로 무효화한다.
  // same-scope refresh는 hasData를 유지해 background refreshing + stale-preserve 계약을 보존한다.
  if (shouldInvalidateSellerOrdersScope(scope, scopeKey)) {
    scopeRef.current = scopeKey;
    hasDataRef.current = false;
    requestIdRef.current += 1;
    setScope(scopeKey);
    setOrders([]);
    setError(null);
    setLoading(true);
    setRefreshing(false);
  }

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    void tick;
    void scopeKey;
    const authState = resolveSellerOrdersAuthState(sessionStatus, storeId, token);
    if (authState === 'loading') {
      if (isSellerOrdersBackgroundRefresh(hasDataRef.current)) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      return;
    }
    if (authState === 'missing') {
      requestIdRef.current += 1;
      hasDataRef.current = false;
      scopeRef.current = scopeKey;
      setOrders([]);
      setError(SELLER_ORDERS_AUTH_ERROR);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const requestScopeKey = scopeKey;
    scopeRef.current = requestScopeKey;
    const isBackground = isSellerOrdersBackgroundRefresh(hasDataRef.current);
    if (isBackground) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    const myId = requestIdRef.current + 1;
    requestIdRef.current = myId;
    let active = true;
    apiJson<Order[]>(buildSellerOrdersPath(storeId as string), token as string)
      .then((payload) => {
        if (shouldIgnoreSellerOrdersResponse(active, requestIdRef.current, myId)) return;
        if (shouldIgnoreSellerOrdersScopeResponse(scopeRef.current, requestScopeKey)) return;
        if (!Array.isArray(payload)) throw new Error('주문 목록 응답 형식이 올바르지 않습니다.');
        hasDataRef.current = true;
        setOrders(payload);
      })
      .catch((err: unknown) => {
        if (shouldIgnoreSellerOrdersResponse(active, requestIdRef.current, myId)) return;
        if (shouldIgnoreSellerOrdersScopeResponse(scopeRef.current, requestScopeKey)) return;
        // Same-scope 실패만 이전 정상 목록을 유지한다 (EMPTY collapse 방지).
        // Cross-scope 실패는 이미 scope 전환 시 clear되었으므로 A stale을 복구하지 않는다.
        setError(err instanceof Error ? err.message : '주문 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (shouldIgnoreSellerOrdersResponse(active, requestIdRef.current, myId)) return;
        if (shouldIgnoreSellerOrdersScopeResponse(scopeRef.current, requestScopeKey)) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      active = false;
    };
  }, [token, sessionStatus, storeId, scopeKey, tick]);

  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState === 'hidden') return;
      refresh();
    };
    const onFocus = () => {
      revalidate();
    };
    const onVisibilityChange = () => {
      if (!document.hidden) revalidate();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  const groupCounts = useMemo(() => {
    const result = {
      ACTION_REQUIRED: 0,
      WAITING: 0,
      IN_DELIVERY: 0,
      DONE: 0,
      CANCELLED: 0,
    } as Record<OrderGroup, number>;
    for (const order of orders) {
      result[STATUS_GROUP_MAP[order.status]] += 1;
    }
    return result;
  }, [orders]);

  return { orders, loading, refreshing, error, groupCounts, refresh };
}
