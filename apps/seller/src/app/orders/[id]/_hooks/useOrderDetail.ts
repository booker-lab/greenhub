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
  isOrderDetailAuthError,
  isOrderDetailBackgroundRefresh,
  isOrderDetailNotFoundError,
  resolveOrderDetailAuthState,
  resolveOrderDetailView,
  SELLER_ORDER_DETAIL_AUTH_ERROR,
  SELLER_ORDER_DETAIL_READ_ERROR,
  shouldIgnoreOrderDetailResponse,
  shouldInvalidateOrderDetailScope,
  shouldInvalidateOrderDetailSupplementary,
  shouldRevalidateOrderDetailOnVisibilityChange,
  shouldRevalidateOrderDetailOnWindowFocus,
  type OrderDetailViewState,
} from './useOrderDetail.recovery';

export {
  buildOrderDetailPath,
  isOrderDetailAuthError,
  isOrderDetailBackgroundRefresh,
  isOrderDetailNotFoundError,
  resolveOrderDetailAuthState,
  resolveOrderDetailView,
  SELLER_ORDER_DETAIL_AUTH_ERROR,
  SELLER_ORDER_DETAIL_READ_ERROR,
  shouldIgnoreOrderDetailResponse,
  shouldInvalidateOrderDetailScope,
  shouldInvalidateOrderDetailSupplementary,
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
  authFailed: boolean;
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
  const [authFailed, setAuthFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const requestIdRef = useRef(0);
  const hasDataRef = useRef(false);
  const scopeRef = useRef<{ orderId: string; storeId: string | null; token: string | null | undefined } | null>(null);
  const productNameProductIdRef = useRef<string | null>(null);
  const groupConfigProductIdRef = useRef<string | null>(null);

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
      scopeRef.current = { orderId, storeId, token };
      productNameProductIdRef.current = null;
      groupConfigProductIdRef.current = null;
      setOrder(null);
      setProductName(null);
      setGroupConfig(null);
      setNotFound(false);
      setAuthFailed(false);
      setError(SELLER_ORDER_DETAIL_AUTH_ERROR);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const nextScope = { orderId, storeId, token };
    if (shouldInvalidateOrderDetailScope(scopeRef.current, nextScope)) {
      // orderId/storeId/token 변경: 이전 scope의 order·보조 정보를 새 scope로 leak하지 않는다.
      requestIdRef.current += 1;
      hasDataRef.current = false;
      scopeRef.current = nextScope;
      productNameProductIdRef.current = null;
      groupConfigProductIdRef.current = null;
      setOrder(null);
      setProductName(null);
      setGroupConfig(null);
      setNotFound(false);
      setAuthFailed(false);
      setError(null);
      setLoading(true);
      setRefreshing(false);
    } else if (!scopeRef.current) {
      scopeRef.current = nextScope;
    }

    const isBackground = isOrderDetailBackgroundRefresh(hasDataRef.current);
    if (isBackground) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    setNotFound(false);
    setAuthFailed(false);
    const myId = requestIdRef.current + 1;
    requestIdRef.current = myId;
    let active = true;
    apiJson<Order>(buildOrderDetailPath(storeId as string, orderId), token as string)
      .then((payload) => {
        if (shouldIgnoreOrderDetailResponse(active, requestIdRef.current, myId)) return;
        hasDataRef.current = true;
        setOrder(payload);
        setNotFound(false);
        setAuthFailed(false);
        setError(null);
      })
      .catch((err: unknown) => {
        if (shouldIgnoreOrderDetailResponse(active, requestIdRef.current, myId)) return;
        if (isOrderDetailAuthError(err)) {
          // 401/403은 not-found나 일반 fetch-error와 섞지 않고 AUTH_FAILED로 닫는다.
          // stale order를 보존하지 않고 protected data를 가린다.
          hasDataRef.current = false;
          productNameProductIdRef.current = null;
          groupConfigProductIdRef.current = null;
          setOrder(null);
          setProductName(null);
          setGroupConfig(null);
          setNotFound(false);
          setAuthFailed(true);
          setError(SELLER_ORDER_DETAIL_AUTH_ERROR);
          return;
        }
        if (isOrderDetailNotFoundError(err)) {
          hasDataRef.current = false;
          productNameProductIdRef.current = null;
          groupConfigProductIdRef.current = null;
          setOrder(null);
          setProductName(null);
          setGroupConfig(null);
          setNotFound(true);
          setAuthFailed(false);
          setError(null);
          return;
        }
        // 기존 detail이 있으면 제거하지 않고 stale로 보존한다.
        // 단 최초 조회 실패(데이터 없음)는 order null + READ_FAILED로 닫는다.
        setNotFound(false);
        setAuthFailed(false);
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
    if (!order) {
      // authoritative order가 없으면 이전 보조 정보를 leak하지 않는다.
      productNameProductIdRef.current = null;
      setProductName((prev) => (prev === null ? prev : null));
      return;
    }
    if (order.productName) {
      productNameProductIdRef.current = order.productId;
      setProductName(order.productName);
      return;
    }
    const snapshotProductName = order.orderItems?.[0]?.productName;
    if (snapshotProductName) {
      productNameProductIdRef.current = order.productId;
      setProductName(snapshotProductName);
      return;
    }
    if (!firebaseReady) return;
    // Firestore fallback: 이전 productId의 이름을 새 주문에 노출하지 않도록 먼저 clear.
    if (shouldInvalidateOrderDetailSupplementary(productNameProductIdRef.current, order.productId)) {
      setProductName(null);
    }
    productNameProductIdRef.current = order.productId;
    const productId = order.productId;
    let active = true;
    getDoc(doc(db, 'products', productId))
      .then((snap) => {
        if (!active) return;
        // 늦은 응답이 최신 order scope를 덮지 않게 한다.
        if (productNameProductIdRef.current !== productId) return;
        if (snap.exists()) {
          setProductName((snap.data() as { name: string }).name ?? null);
        } else {
          setProductName(null);
        }
      })
      .catch(() => {
        if (!active) return;
        if (productNameProductIdRef.current !== productId) return;
        // 보조 read 실패는 order를 지우지 않고 이름만 비운다.
        setProductName(null);
      });
    return () => {
      active = false;
    };
  }, [order, firebaseReady]);

  useEffect(() => {
    if (!order) {
      // order 없음에서는 이전 group config를 표시하지 않는다.
      groupConfigProductIdRef.current = null;
      setGroupConfig((prev) => (prev === null ? prev : null));
      return;
    }
    if (order.saleType !== 'group') {
      // group이 아닌 주문에서는 이전 group config를 표시하지 않는다.
      // firebase 준비 여부와 무관하게 즉시 가린다.
      groupConfigProductIdRef.current = null;
      setGroupConfig((prev) => (prev === null ? prev : null));
      return;
    }
    if (!firebaseReady) return;
    // productId 변경 시 이전 group config를 새 상품에 표시하지 않도록 먼저 clear.
    // 동일 productId 재조회에서는 기존 값을 유지하고 fetch를 생략하지 않는다(실패 후 재시도 대비).
    // 단 이미 같은 productId로 로드된 값이 있으면 불필요한 clear를 피한다.
    if (shouldInvalidateOrderDetailSupplementary(groupConfigProductIdRef.current, order.productId)) {
      setGroupConfig(null);
    }
    groupConfigProductIdRef.current = order.productId;
    const productId = order.productId;
    let active = true;
    const ref = doc(db, 'groupProductConfig', productId);
    getDoc(ref)
      .then((snap) => {
        if (!active) return;
        if (groupConfigProductIdRef.current !== productId) return;
        if (snap.exists()) {
          const data = snap.data();
          if (data.recruitDeadline?.toDate)
            data.recruitDeadline = data.recruitDeadline.toDate().toISOString();
          if (data.groupDeliveryDate?.toDate)
            data.groupDeliveryDate = data.groupDeliveryDate.toDate().toISOString();
          setGroupConfig(data as GroupProductConfig);
        } else {
          setGroupConfig(null);
        }
      })
      .catch(() => {
        if (!active) return;
        if (groupConfigProductIdRef.current !== productId) return;
        // 보조 read 실패는 order를 지우지 않고 group 현황만 비운다.
        setGroupConfig(null);
      });
    return () => {
      active = false;
    };
  }, [order, firebaseReady]);

  const view = resolveOrderDetailView({
    authState: resolveOrderDetailAuthState(sessionStatus, storeId, token),
    hasOrder: order !== null,
    isLoading: loading,
    error,
    notFound,
    authFailed,
  });
  const isStale = view === 'READY' && error !== null;

  return { order, productName, groupConfig, loading, refreshing, error, notFound, authFailed, isStale, view, refresh, reconcile };
}
