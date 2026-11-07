'use client';

import type { Order } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type OrderGroup, STATUS_GROUP_MAP } from '@/app/orders/_constants';
import { apiJson } from '@/lib/api';
import {
  collectActionRequiredOrderIds,
  countNewActionRequiredOrders,
  shouldPollSellerOrders,
} from './useOrders.freshness';
import {
  buildSellerOrdersPath,
  buildSellerOrdersQueryString,
  buildSellerOrdersScopeKey,
  isSellerOrdersBackgroundRefresh,
  resolveSellerOrdersAuthState,
  SELLER_ORDERS_AUTH_ERROR,
  type SellerOrdersQuery,
  shouldIgnoreSellerOrdersResponse,
  shouldIgnoreSellerOrdersScopeResponse,
  shouldInvalidateSellerOrdersScope,
} from './useOrders.recovery';

export { SELLER_ORDERS_POLL_INTERVAL_MS } from './useOrders.freshness';
export type { SellerOrdersAuthState, SellerOrdersQuery } from './useOrders.recovery';
export {
  ACTIVE_SELLER_ORDERS_QUERY,
  buildSellerOrdersPath,
  buildSellerOrdersScopeKey,
  isSellerOrdersBackgroundRefresh,
  resolveSellerOrdersAuthState,
  resolveSellerOrdersInitialView,
  SELLER_ORDERS_AUTH_ERROR,
  shouldIgnoreSellerOrdersResponse,
  shouldIgnoreSellerOrdersScopeResponse,
  shouldInvalidateSellerOrdersScope,
} from './useOrders.recovery';

interface UseOrdersOptions {
  /** 화면이 보이는 동안 이 간격(ms)으로 다시 읽는다. 빼면 화면 복귀 때만 다시 읽는다. */
  pollIntervalMs?: number;
  /** 같은 범위를 다시 읽은 결과에 이전에 없던 처리 필요 주문이 생기면 그 수로 부른다. */
  onNewActionRequiredOrders?: (count: number) => void;
}

interface UseOrdersResult {
  orders: Order[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  groupCounts: Record<OrderGroup, number>;
  refresh: () => void;
}

/**
 * 판매자 주문 목록. query로 범위를 좁힌다(진행 중 주문 전부 또는 한 회차의 주문 전부).
 * query를 빼면 기존처럼 모든 기간의 주문을 받는다 — 주문이 쌓일수록 커지므로 새 화면은 쓰지 않는다.
 */
export function useOrders(
  storeId: string | null,
  query?: SellerOrdersQuery,
  options?: UseOrdersOptions,
): UseOrdersResult {
  const { data: session, status: sessionStatus } = useSession();
  const token = session?.user.accessToken;
  const queryString = buildSellerOrdersQueryString(query);
  const scopeKey = buildSellerOrdersScopeKey(storeId, token, queryString);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [scope, setScope] = useState(scopeKey);
  const scopeRef = useRef(scopeKey);
  const requestIdRef = useRef(0);
  const hasDataRef = useRef(false);
  // 응답을 반영할 요청이 진행 중인지. 간격 재조회가 겹쳐 부르지 않게 한다.
  const inFlightRef = useRef(false);
  // 마지막으로 받은 같은 범위 목록의 처리 필요 주문 id. 새 주문 감지 기준이며 범위가 바뀌면 비운다.
  const actionRequiredIdsRef = useRef<Set<string> | null>(null);
  const pollIntervalMs = options?.pollIntervalMs;
  const onNewActionRequiredRef = useRef(options?.onNewActionRequiredOrders);
  onNewActionRequiredRef.current = options?.onNewActionRequiredOrders;

  // Cross-scope reuse 금지: store/token이 바뀌면 이전 scope의
  // orders/count/badge(hasData)/error authority를 렌더 단계에서 동기적으로 무효화한다.
  // same-scope refresh는 hasData를 유지해 background refreshing + stale-preserve 계약을 보존한다.
  if (shouldInvalidateSellerOrdersScope(scope, scopeKey)) {
    scopeRef.current = scopeKey;
    hasDataRef.current = false;
    actionRequiredIdsRef.current = null;
    inFlightRef.current = false;
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
      actionRequiredIdsRef.current = null;
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
    inFlightRef.current = true;
    let active = true;
    apiJson<Order[]>(`${buildSellerOrdersPath(storeId as string)}${queryString}`, token as string)
      .then((payload) => {
        if (shouldIgnoreSellerOrdersResponse(active, requestIdRef.current, myId)) return;
        if (shouldIgnoreSellerOrdersScopeResponse(scopeRef.current, requestScopeKey)) return;
        if (!Array.isArray(payload)) throw new Error('주문 목록 응답 형식이 올바르지 않습니다.');
        hasDataRef.current = true;
        const nextActionRequiredIds = collectActionRequiredOrderIds(payload);
        const added = countNewActionRequiredOrders(
          actionRequiredIdsRef.current,
          nextActionRequiredIds,
        );
        actionRequiredIdsRef.current = nextActionRequiredIds;
        setOrders(payload);
        if (added > 0) onNewActionRequiredRef.current?.(added);
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
        inFlightRef.current = false;
        if (shouldIgnoreSellerOrdersScopeResponse(scopeRef.current, requestScopeKey)) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      active = false;
      inFlightRef.current = false;
    };
  }, [token, sessionStatus, storeId, scopeKey, queryString, tick]);

  // 화면이 보이는 동안만 일정 간격으로 다시 읽는다. 숨은 탭이거나 이미 읽는 중이면 건너뛴다.
  useEffect(() => {
    if (!pollIntervalMs || pollIntervalMs <= 0) return;
    const timer = setInterval(() => {
      if (
        !shouldPollSellerOrders({
          hidden: document.visibilityState === 'hidden',
          inFlight: inFlightRef.current,
        })
      ) {
        return;
      }
      refresh();
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [pollIntervalMs, refresh]);

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
