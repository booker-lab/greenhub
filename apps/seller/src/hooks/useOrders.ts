'use client';

import type { Order } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type OrderGroup, STATUS_GROUP_MAP } from '@/app/orders/_constants';
import { apiJson } from '@/lib/api';

interface UseOrdersResult {
  orders: Order[];
  loading: boolean;
  error: string | null;
  groupCounts: Record<OrderGroup, number>;
  /** 주문 목록을 다시 조회한다. fetch 실패 시 retry와 수동 새로고침이 공유하는 단일 경로다. */
  refresh: () => void;
}

export function useOrders(storeId: string | null): UseOrdersResult {
  const { data: session, status: sessionStatus } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  // 탭 복귀 시 무기한 stale로 남지 않도록 최소 freshness guard.
  // 전역 realtime/polling 없이 order-list boundary의 명시적 refetch로만 처리한다.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const onFocus = () => {
      setRefreshKey((key) => key + 1);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') setRefreshKey((key) => key + 1);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    void refreshKey; // 명시적 refresh 무효화 키. 값 자체는 읽지 않고 재조회 트리거로만 사용한다.
    const token = session?.user.accessToken;
    if (sessionStatus === 'loading') {
      setLoading(true);
      return;
    }
    if (!storeId || !token) {
      setOrders([]);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    apiJson<Order[]>(`/stores/${encodeURIComponent(storeId)}/orders`, token)
      .then((payload) => {
        if (!active) return;
        if (!Array.isArray(payload)) throw new Error('주문 목록 응답 형식이 올바르지 않습니다.');
        setOrders(payload);
      })
      .catch((err: unknown) => {
        if (!active) return;
        // root-cause: fetch 실패를 빈 배열로 collapse하지 않는다.
        // `error`가 canonical owner이며, 이전 성공 목록은 유지한다.
        // 최초 조회 실패 시 orders는 초기 [] 그대로이나 UI는 error를 먼저 분기한다.
        setError(err instanceof Error ? err.message : '주문 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session?.user.accessToken, sessionStatus, storeId, refreshKey]);

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

  return { orders, loading, error, groupCounts, refresh };
}
