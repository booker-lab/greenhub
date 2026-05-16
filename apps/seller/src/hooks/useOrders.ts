'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, getFirebaseAuth } from '@/lib/firebase';
import type { Order, OrderStatus } from '@greenhub/shared';
import { STATUS_GROUP_MAP, type OrderGroup } from '@/app/orders/_constants';


interface UseOrdersResult {
  orders: Order[];
  loading: boolean;
  error: string | null;
  groupCounts: Record<OrderGroup, number>;
  firebaseReady: boolean;
}

/**
 * storeId의 전체 주문을 실시간 구독.
 * 탭 필터링은 클라이언트에서 수행 (Firestore 복합 인덱스 절약).
 */
export function useOrders(storeId: string | null): UseOrdersResult {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [firebaseReady, setFirebaseReady] = useState(false);

  // Firebase Auth 완료 대기 (signInWithCustomToken race condition 방지)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      setFirebaseReady(!!user);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!storeId || !firebaseReady) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'orders'),
      where('storeId', '==', storeId),
      orderBy('createdAt', 'desc'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order);
        setOrders(items);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [storeId, firebaseReady]);

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

  return { orders, loading, error, groupCounts, firebaseReady };
}
