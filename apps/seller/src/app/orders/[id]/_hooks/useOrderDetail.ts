'use client';

import type { GroupProductConfig, Order } from '@greenhub/shared';
import { doc, getDoc } from 'firebase/firestore';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFirebaseReady } from '@/app/providers';
import { apiJson } from '@/lib/api';
import { db } from '@/lib/firebase';
import {
  buildOrderDetailPath,
  isOrderDetailBackgroundRefresh,
  isOrderDetailNotFoundError,
  resolveOrderDetailAuthState,
  resolveOrderDetailView,
  SELLER_ORDER_DETAIL_AUTH_ERROR,
  SELLER_ORDER_DETAIL_READ_ERROR,
  shouldIgnoreOrderDetailResponse,
  shouldRevalidateOrderDetailOnVisibilityChange,
  shouldRevalidateOrderDetailOnWindowFocus,
  type OrderDetailViewState,
} from './useOrderDetail.recovery';

export {
  buildOrderDetailPath,
  isOrderDetailBackgroundRefresh,
  isOrderDetailNotFoundError,
  resolveOrderDetailAuthState,
  resolveOrderDetailView,
  SELLER_ORDER_DETAIL_AUTH_ERROR,
  SELLER_ORDER_DETAIL_READ_ERROR,
  shouldIgnoreOrderDetailResponse,
  shouldRevalidateOrderDetailOnVisibilityChange,
  shouldRevalidateOrderDetailOnWindowFocus,
} from './useOrderDetail.recovery';
export type { OrderDetailViewState } from './useOrderDetail.recovery';

export interface UseOrderDetailResult {
  order: Order | null;
  productName: string | null;
  groupConfig: GroupProductConfig | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  notFound: boolean;
  isStale: boolean;
  view: OrderDetailViewState;
  refresh: () => void;
  reconcile: () => void;
}

/**
 * 주문 상세 GET의 단일 owner.
 * `GET /stores/:storeId/orders/:orderId`가 authoritative read이며
 * page나 action hook에 독립 fetch 경로를 만들지 않는다.
 * Firestore는 기존 productName/groupConfig 보강 범위만 유지한다.
 */
export function useOrderDetail(orderId: string): UseOrderDetailResult {
  const { data: session, status: sessionStatus } = useSession();
  const firebaseReady = useFirebaseReady();
  const storeId = session?.user.storeId ?? null;
  const token = session?.user.accessToken;
  const [order, setOrder] = useState<Order | null>(null);
  const [productName, setProductName] = useState<string | null>(null);
  const [groupConfig, setGroupConfig] = useState<GroupProductConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tick, setTick] = useState(0);
  const requestIdRef = useRef(0);
  const hasDataRef = useRef(false);

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  // Post-mutation reconciliation은 동일한 authoritative GET 경로를 재사용한다.
  const reconcile = refresh;

  useEffect(() => {
    void tick;
    const authState = resolveOrderDetailAuthState(sessionStatus, storeId, token);
    if (authState === 'loading') {
      if (isOrderDetailBackgroundRefresh(hasDataRef.current)) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      return;
    }
    if (authState === 'missing') {
      requestIdRef.current += 1;
      hasDataRef.current = false;
      setOrder(null);
      setNotFound(false);
      setError(SELLER_ORDER_DETAIL_AUTH_ERROR);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const isBackground = isOrderDetailBackgroundRefresh(hasDataRef.current);
    if (isBackground) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    setNotFound(false);
    const myId = requestIdRef.current + 1;
    requestIdRef.current = myId;
    let active = true;
    apiJson<Order>(buildOrderDetailPath(storeId as string, orderId), token as string)
      .then((payload) => {
        if (shouldIgnoreOrderDetailResponse(active, requestIdRef.current, myId)) return;
        hasDataRef.current = true;
        setOrder(payload);
        setNotFound(false);
      })
      .catch((err: unknown) => {
        if (shouldIgnoreOrderDetailResponse(active, requestIdRef.current, myId)) return;
        if (isOrderDetailNotFoundError(err)) {
          hasDataRef.current = false;
          setOrder(null);
          setNotFound(true);
          setError(null);
          return;
        }
        // 기존 detail이 있으면 제거하지 않고 stale로 보존한다.
        setNotFound(false);
        if (!hasDataRef.current) {
          setOrder(null);
        }
        setError(err instanceof Error ? err.message : SELLER_ORDER_DETAIL_READ_ERROR);
      })
      .finally(() => {
        if (shouldIgnoreOrderDetailResponse(active, requestIdRef.current, myId)) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      active = false;
    };
  }, [orderId, sessionStatus, storeId, token, tick]);

  useEffect(() => {
    const onFocus = () => {
      if (shouldRevalidateOrderDetailOnWindowFocus()) refresh();
    };
    const onVisibilityChange = () => {
      if (shouldRevalidateOrderDetailOnVisibilityChange(document.hidden)) refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  useEffect(() => {
    if (!order || !firebaseReady) return;
    if (order.productName) {
      setProductName(order.productName);
      return;
    }
    const snapshotProductName = order.orderItems?.[0]?.productName;
    if (snapshotProductName) {
      setProductName(snapshotProductName);
      return;
    }
    getDoc(doc(db, 'products', order.productId)).then((snap) => {
      if (snap.exists()) setProductName((snap.data() as { name: string }).name ?? null);
    });
  }, [order, firebaseReady]);

  useEffect(() => {
    if (!order || !firebaseReady || order.saleType !== 'group') return;
    const ref = doc(db, 'groupProductConfig', order.productId);
    getDoc(ref).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.recruitDeadline?.toDate)
          data.recruitDeadline = data.recruitDeadline.toDate().toISOString();
        if (data.groupDeliveryDate?.toDate)
          data.groupDeliveryDate = data.groupDeliveryDate.toDate().toISOString();
        setGroupConfig(data as GroupProductConfig);
      }
    });
  }, [order, firebaseReady]);

  const view = resolveOrderDetailView({
    authState: resolveOrderDetailAuthState(sessionStatus, storeId, token),
    hasOrder: order !== null,
    isLoading: loading,
    error,
    notFound,
  });
  const isStale = view === 'READY' && error !== null;

  return { order, productName, groupConfig, loading, refreshing, error, notFound, isStale, view, refresh, reconcile };
}
