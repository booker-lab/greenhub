'use client';

import type { Product } from '@greenhub/shared';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useCallback, useSyncExternalStore } from 'react';
import { useFirebaseReady } from '@/app/providers';
import { db } from '@/lib/firebase';
import {
  createStoreProductsHub,
  INITIAL_STORE_PRODUCTS_SNAPSHOT,
  type ListenStoreProducts,
  type StoreProductsSnapshot,
} from './useStoreProducts.hub';

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

// 화면 전환에서 이전 화면 정리와 새 화면 구독 사이 틈, 짧은 왕복 이동은 같은 구독으로 받는다.
const RELEASE_DELAY_MS = 60_000;

const NO_STORE_SNAPSHOT: StoreProductsSnapshot = Object.freeze({
  products: [],
  loading: false,
  error: null,
  hasLoaded: false,
}) as StoreProductsSnapshot;

const listenStoreProducts: ListenStoreProducts = (storeId, onNext, onError) =>
  onSnapshot(
    query(collection(db, 'products'), where('storeId', '==', storeId)),
    (snap) => {
      const items = snap.docs
        .map((d) => {
          const data = d.data();
          if (data.createdAt?.toDate) data.createdAt = data.createdAt.toDate().toISOString();
          if (data.updatedAt?.toDate) data.updatedAt = data.updatedAt.toDate().toISOString();
          return { id: d.id, ...data } as Product;
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onNext(items);
    },
    (err) => {
      onError(err instanceof Error ? err.message : '상품을 불러오지 못했습니다.');
    },
  );

// 같은 매장 상품 구독은 화면들이 하나를 나눠 쓴다.
const storeProductsHub = createStoreProductsHub({
  listen: listenStoreProducts,
  releaseDelayMs: RELEASE_DELAY_MS,
});

export function useStoreProducts(storeId: string | null): UseStoreProductsResult {
  // products 규칙은 Firebase에 로그인한 소유 판매자만 읽게 한다. 첫 로그인 직후 custom token
  // 로그인이 끝나기 전에 구독하면 권한 오류로 listener가 끝나므로, 로그인된 뒤에만 구독을 붙잡는다.
  // 로그인 전에는 현재 상태(첫 로딩 또는 이전 데이터)를 그대로 지켜본다.
  const firebaseReady = useFirebaseReady();

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!storeId) return () => {};
      return storeProductsHub.subscribe(storeId, onChange, firebaseReady);
    },
    [storeId, firebaseReady],
  );
  // 데이터는 storeId별로만 읽어 매장이 바뀌면(A→B, A→null, null→A) 이전 매장 데이터를 새 scope의
  // authoritative data처럼 노출하지 않는다.
  const getSnapshot = useCallback(
    () => (storeId ? storeProductsHub.getSnapshot(storeId) : NO_STORE_SNAPSHOT),
    [storeId],
  );
  const getServerSnapshot = useCallback(
    () => (storeId ? INITIAL_STORE_PRODUCTS_SNAPSHOT : NO_STORE_SNAPSHOT),
    [storeId],
  );
  const { products, loading, error, hasLoaded } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const retry = useCallback(() => {
    if (storeId) storeProductsHub.retry(storeId);
  }, [storeId]);

  const isStale = hasLoaded && error !== null;
  return { products, loading, error, retry, hasLoaded, isStale };
}
