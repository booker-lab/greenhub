'use client';

import type {
  Category,
  ColorOption,
  DeliveryMethod,
  Product,
  SaleType,
  Variety,
} from '@greenhub/shared';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';

export interface StoreInfo {
  id: string;
  name: string;
  ceoName: string;
  phone: string;
  address: string;
  logoUrl: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
export type ProductSort = 'latest' | 'popular' | 'price_asc' | 'price_desc';

export interface ProductListFilters {
  priceMin?: number;
  priceMax?: number;
  deliveryMethod?: DeliveryMethod;
}

interface ProductListResponse {
  items: Product[];
  total: number;
}

/**
 * API를 통해 활성 상품 목록 조회
 * @param category 카테고리 필터 (없으면 전체)
 */
export function useProducts(
  category?: Category,
  colors?: ColorOption[],
  saleType?: SaleType,
  sort: ProductSort = 'latest',
  filters: ProductListFilters = {},
) {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const colorKey = colors?.join(',') ?? '';
  const { priceMin, priceMax, deliveryMethod } = filters;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setProducts([]);
    setTotal(0);
    async function fetchProducts() {
      try {
        const params = new URLSearchParams({ isActive: 'true' });
        if (category) params.set('category', category);
        if (colorKey) {
          for (const color of colorKey.split(',')) {
            params.append('colors', color);
          }
        }
        if (saleType) params.set('saleType', saleType);
        if (priceMin !== undefined) params.set('priceMin', String(priceMin));
        if (priceMax !== undefined) params.set('priceMax', String(priceMax));
        if (deliveryMethod) params.set('deliveryMethod', deliveryMethod);
        if (sort !== 'latest') params.set('sort', sort);
        const res = await fetch(`${API_URL}/products?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`서버 오류 ${res.status}`);
        const data = (await res.json()) as Product[] | ProductListResponse;
        const items: Product[] = Array.isArray(data) ? data : (data.items ?? []);
        setProducts(items);
        setTotal(Array.isArray(data) ? items.length : (data.total ?? items.length));
        setError(null);
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : '상품 조회 실패');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    fetchProducts();
    return () => controller.abort();
  }, [category, saleType, colorKey, sort, priceMin, priceMax, deliveryMethod]);

  return { products, total, loading, error };
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
