'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Product, Category, ColorOption, SaleType, Variety } from '@greenhub/shared';
import { getApiBaseUrl } from '@/lib/api-base-url';
import {
  PublicStoreProfileNotFoundError,
  fetchPublicStoreProfile,
} from '@/lib/public-store-profile';

export interface StoreInfo {
  id: string;
  name: string;
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
 * 단일 상품 조회 — public Product API 사용.
 * Firestore products 직접 읽기를 사용하지 않는다 (Rules convergence 후 익명 원문 read 차단).
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
    let cancelled = false;
    setLoading(true);
    setError(null);
    setProduct(null);
    async function fetchProduct() {
      try {
        const res = await fetch(`${API_URL}/products/${encodeURIComponent(productId)}`);
        if (cancelled) return;
        if (res.status === 404) {
          setError('상품을 찾을 수 없습니다.');
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error(`상품 조회 오류: ${res.status}`);
        const data = (await res.json()) as Product;
        if (cancelled) return;
        setProduct(data);
        setError(null);
        setLoading(false);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '상품 조회 실패');
        setLoading(false);
      }
    }
    void fetchProduct();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  return { product, loading, error };
}

/**
 * 단일 스토어 공개 프로필 조회 — public-profile API 사용.
 * Firestore stores 직접 읽기를 사용하지 않는다.
 * network failure(error)와 missing(isMissing)을 구분한다.
 */
export function useStore(storeId: string | null) {
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMissing, setIsMissing] = useState(false);

  useEffect(() => {
    if (!storeId) {
      setStore(null);
      setError(null);
      setIsMissing(false);
      setLoading(false);
      return;
    }
    const sid = storeId;
    let cancelled = false;
    setStore(null);
    setError(null);
    setIsMissing(false);
    setLoading(true);
    async function fetchStore() {
      try {
        const profile = await fetchPublicStoreProfile(sid);
        if (cancelled) return;
        setStore({ id: profile.id, name: profile.name, logoUrl: profile.logoUrl });
        setError(null);
        setIsMissing(false);
      } catch (e: unknown) {
        if (cancelled) return;
        if (e instanceof PublicStoreProfileNotFoundError) {
          setStore(null);
          setIsMissing(true);
          setError(null);
        } else {
          // network failure는 missing으로 표현하지 않는다.
          setStore(null);
          setIsMissing(false);
          setError(e instanceof Error ? e.message : '스토어 조회 실패');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchStore();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  return { store, loading, error, isMissing };
}

/**
 * 단일 품종 조회 — public Varieties API 사용.
 * Firestore varieties 직접 읽기를 사용하지 않는다.
 */
export function useVariety(varietyId: string | null | undefined) {
  const [variety, setVariety] = useState<Variety | null>(null);

  useEffect(() => {
    if (!varietyId) {
      setVariety(null);
      return;
    }
    let cancelled = false;
    setVariety(null);
    fetch(`${API_URL}/varieties/${encodeURIComponent(varietyId)}`)
      .then((res) => {
        if (cancelled) return null;
        if (!res.ok) return null;
        return res.json() as Promise<Variety>;
      })
      .then((data) => {
        if (cancelled || !data) return;
        setVariety(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [varietyId]);

  return { variety };
}
