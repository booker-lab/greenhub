'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { Order } from '@greenhub/shared';
import { getApiBaseUrl } from '@/lib/api-base-url';

const API_URL = getApiBaseUrl();

interface UseOrdersResult {
  orders: Order[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useOrders(): UseOrdersResult {
  const { data: session } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // 최신 요청 식별자: cleanup된 이전 effect의 stale 응답이 최신 결과를 덮지 않게 한다.
  const requestSequenceRef = useRef(0);
  // session/user scope: 이전 사용자의 주문이 새 scope 결과로 노출되지 않게 한다.
  // useAddresses의 token scope 격리와 동일한 계약이다.
  const prevScopeRef = useRef<string | null>(null);

  const refetch = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    // tick은 의도적인 수동 refetch 트리거다: 아래 void 참조로 effect와 명시적으로 연결한다.
    void tick;
    const userId = session?.user?.id;
    const token = session?.user?.accessToken;
    const scopeKey = userId && token ? `${userId}\0${token}` : null;
    if (!userId || !token || !scopeKey) {
      prevScopeRef.current = null;
      setOrders([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (prevScopeRef.current !== scopeKey) {
      prevScopeRef.current = scopeKey;
      setOrders([]);
      setError(null);
    }

    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    let cancelled = false;
    setLoading(true);

    async function fetchOrders() {
      try {
        const url = `${API_URL}/orders?userId=${userId}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled || requestSequenceRef.current !== requestId) return;
        if (!res.ok) throw new Error(`주문 조회 오류: ${res.status}`);

        const data = (await res.json()) as Order[];
        if (cancelled || requestSequenceRef.current !== requestId) return;
        // 성공만 상태를 교체한다: error clear + 정상 empty([])도 성공으로 확정한다.
        setOrders(data);
        setError(null);
        setLoading(false);
      } catch (e: unknown) {
        if (cancelled || requestSequenceRef.current !== requestId) return;
        // 실패는 기존 성공 데이터를 삭제하지 않는다: orders 유지, error만 교체한다.
        setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
        setLoading(false);
      }
    }

    fetchOrders();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, session?.user?.accessToken, tick]);

  return { orders, loading, error, refetch };
}
