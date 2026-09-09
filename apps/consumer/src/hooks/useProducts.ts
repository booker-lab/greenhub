'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Product, Category, ColorOption, SaleType, Variety } from '@greenhub/shared';
import { getApiBaseUrl } from '@/lib/api-base-url';

export interface StoreInfo {
  id: string;
  name: string;
  ceoName: string;
  phone: string;
  address: string;
  logoUrl: string | null;
}

const API_URL = getApiBaseUrl();

/**
 * API를 통해 활성 상품 목록 조회
 * @param category 카테고리 필터 (없으면 전체)
 */
export function useProducts(
  category?: Category,
  colors?: ColorOption[],
  saleType?: SaleType,
) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // 최신 요청 식별자: stale 응답(이전 scope·이전 retry)이 최신 결과를 덮지 않게 한다.
  const requestSequenceRef = useRef(0);

  const colorKey = colors?.join(',') ?? '';

  const refetch = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick은 의도적인 수동 refetch 트리거다 — effect 본문에서 직접 읽지 않는다
  useEffect(() => {
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    let cancelled = false;
    setLoading(true);
    // scope 변경·수동 retry 모두 새 fetch 시작 시 이전 scope 데이터를 비운다:
    // 이전 scope 결과가 새 scope인 것처럼 보이는 것을 방지한다.
    setProducts([]);
    async function fetchProducts() {
      try {
        const params = new URLSearchParams({ isActive: 'true' });
        if (category) params.set('category', category);
        if (colorKey) {
          colorKey.split(',').forEach((color) => {
            params.append('colors', color);
          });
        }
        if (saleType) params.set('saleType', saleType);
        const res = await fetch(`${API_URL}/products?${params}`);
        if (cancelled || requestSequenceRef.current !== requestId) return;
        if (!res.ok) throw new Error(`서버 오류 ${res.status}`);
        const data = await res.json();
        const items: Product[] = Array.isArray(data) ? data : (data.items ?? []);
        items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
        if (cancelled || requestSequenceRef.current !== requestId) return;
        setProducts(items);
        setError(null);
        setLoading(false);
      } catch (e: unknown) {
        if (cancelled || requestSequenceRef.current !== requestId) return;
        setError(e instanceof Error ? e.message : '상품 조회 실패');
        setLoading(false);
      }
    }
    fetchProducts();
    return () => {
      cancelled = true;
    };
  }, [category, saleType, colorKey, tick]);

  return { products, loading, error, refetch };
}

/**
 * 단일 상품 조회
 */
export function useProduct(productId: string) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) {
      setLoading(false);
      return;
    }
    async function fetchProduct() {
      try {
        const snap = await getDoc(doc(db, 'products', productId));
        if (snap.exists()) {
          setProduct({ id: snap.id, ...snap.data() } as Product);
        } else {
          setError('상품을 찾을 수 없습니다.');
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '상품 조회 실패');
      } finally {
        setLoading(false);
      }
    }
    fetchProduct();
  }, [productId]);

  return { product, loading, error };
}

/**
 * 단일 스토어 정보 조회
 */
export function useStore(storeId: string | null) {
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!storeId) {
      setLoading(false);
      return;
    }
    const sid = storeId;
    async function fetchStore() {
      try {
        const snap = await getDoc(doc(db, 'stores', sid));
        if (snap.exists()) {
          setStore({ id: snap.id, ...snap.data() } as StoreInfo);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchStore();
  }, [storeId]);

  return { store, loading };
}

export function useVariety(varietyId: string | null | undefined) {
  const [variety, setVariety] = useState<Variety | null>(null);

  useEffect(() => {
    if (!varietyId) {
      setVariety(null);
      return;
    }
    getDoc(doc(db, 'varieties', varietyId))
      .then((snap) =>
        snap.exists() ? setVariety({ id: snap.id, ...snap.data() } as Variety) : null,
      )
      .catch(() => {});
  }, [varietyId]);

  return { variety };
}
