'use client';

import type { Order } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type OrderGroup, STATUS_GROUP_MAP } from '@/app/orders/_constants';
import { apiJson } from '@/lib/api';
import {
  buildSellerOrdersPath,
  isSellerOrdersBackgroundRefresh,
  resolveSellerOrdersAuthState,
  SELLER_ORDERS_AUTH_ERROR,
  shouldIgnoreSellerOrdersResponse,
} from './useOrders.recovery';

export {
  buildSellerOrdersPath,
  isSellerOrdersBackgroundRefresh,
  resolveSellerOrdersAuthState,
  SELLER_ORDERS_AUTH_ERROR,
  shouldIgnoreSellerOrdersResponse,
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
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const requestIdRef = useRef(0);
  const hasDataRef = useRef(false);

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    void tick;
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
      setOrders([]);
      setError(SELLER_ORDERS_AUTH_ERROR);
      setLoading(false);
      setRefreshing(false);
      return;
    }

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
        if (!Array.isArray(payload)) throw new Error('주문 목록 응답 형식이 올바르지 않습니다.');
        hasDataRef.current = true;
        setOrders(payload);
      })
      .catch((err: unknown) => {
        if (shouldIgnoreSellerOrdersResponse(active, requestIdRef.current, myId)) return;
        // 이전 정상 목록이 있으면 유지하고 오류만 기록한다 (EMPTY collapse 방지).
        setError(err instanceof Error ? err.message : '주문 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (shouldIgnoreSellerOrdersResponse(active, requestIdRef.current, myId)) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      active = false;
    };
  }, [token, sessionStatus, storeId, tick]);

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
