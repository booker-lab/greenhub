'use client';

import type { Order } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import { type OrderGroup, STATUS_GROUP_MAP } from '@/app/orders/_constants';
import { apiJson } from '@/lib/api';

interface UseOrdersResult {
  orders: Order[];
  loading: boolean;
  error: string | null;
  groupCounts: Record<OrderGroup, number>;
}

export function useOrders(storeId: string | null): UseOrdersResult {
  const { data: session, status: sessionStatus } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
        setOrders([]);
        setError(err instanceof Error ? err.message : '주문 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session?.user.accessToken, sessionStatus, storeId]);

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

  return { orders, loading, error, groupCounts };
}
