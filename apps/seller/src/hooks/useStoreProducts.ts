'use client';

import type { Product } from '@greenhub/shared';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '@/lib/firebase';
import {
  isStoreProductsBackgroundRefresh,
  shouldIgnoreStoreProductsCallback,
} from './useStoreProducts.recovery';

interface UseStoreProductsResult {
  products: Product[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  /** 현재 scope에서 Firestore 성공 snapshot을 1회 이상 수신했는지. 성공 0건도 true. */
  hasLoaded: boolean;
  /** 이전 정상 데이터가 있는 상태에서 listener가 실패한 stale 상태. */
  isStale: boolean;
}

export function useStoreProducts(storeId: string | null): UseStoreProductsResult {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [scope, setScope] = useState(storeId);
  const scopeRef = useRef(storeId);
  const hasLoadedRef = useRef(false);

  // Scope 변경(A→B, A→null, null→A)이면 이전 store 데이터를
  // 새 scope의 authoritative data처럼 노출하지 않도록 렌더 단계에서 무효화한다.
  if (scope !== storeId) {
    scopeRef.current = storeId;
    hasLoadedRef.current = false;
    setScope(storeId);
    setProducts([]);
    setError(null);
    setHasLoaded(false);
    setLoading(true);
  }

  const retry = useCallback(() => {
    setRetryKey((key) => key + 1);
  }, []);

  useEffect(() => {
    void retryKey;
    const subscribedStoreId = scope;
    scopeRef.current = subscribedStoreId;

    if (!subscribedStoreId) {
      setLoading(false);
      return;
    }

    if (isStoreProductsBackgroundRefresh(hasLoadedRef.current)) {
      // stale 유지 중 재구독은 initial loading으로 되돌리지 않고
      // 이전 오류를 성공 snapshot까지 유지해 fresh처럼 보이지 않게 한다.
      setLoading(false);
    } else {
      setLoading(true);
      setError(null);
    }

    const q = query(collection(db, 'products'), where('storeId', '==', subscribedStoreId));

    let active = true;
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        if (shouldIgnoreStoreProductsCallback(active, subscribedStoreId, scopeRef.current)) {
          return;
        }
        const items = snap.docs
          .map((d) => {
            const data = d.data();
            if (data.createdAt?.toDate) data.createdAt = data.createdAt.toDate().toISOString();
            if (data.updatedAt?.toDate) data.updatedAt = data.updatedAt.toDate().toISOString();
            return { id: d.id, ...data } as Product;
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        hasLoadedRef.current = true;
        setProducts(items);
        setHasLoaded(true);
        setLoading(false);
        setError(null);
      },
      (err) => {
        if (shouldIgnoreStoreProductsCallback(active, subscribedStoreId, scopeRef.current)) {
          return;
        }
        // 첫 조회 실패는 []를 성공 empty로 승격하지 않도록 hasLoaded=false를 유지한다.
        // 이전 정상 snapshot이 있으면 stale 데이터를 지우지 않고 오류만 기록한다.
        setError(err instanceof Error ? err.message : '상품을 불러오지 못했습니다.');
        setLoading(false);
        if (!hasLoadedRef.current) {
          setProducts([]);
          setHasLoaded(false);
        }
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [scope, retryKey]);

  const isStale = hasLoaded && error !== null;
  return { products, loading, error, retry, hasLoaded, isStale };
}
