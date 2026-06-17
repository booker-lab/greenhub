'use client';

import type { ProductSummary, PublicStoreDetail, PublicStoreSummary } from '@greenhub/shared';
import { useEffect, useState } from 'react';

export interface PublicStoreDetailResponse {
  store: PublicStoreDetail;
  products: ProductSummary[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export function usePublicStores() {
  const [stores, setStores] = useState<PublicStoreSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStores() {
      try {
        const res = await fetch(`${API_URL}/public/stores`);
        if (!res.ok) throw new Error(`서버 오류 ${res.status}`);
        const data = await res.json();
        setStores(Array.isArray(data) ? data : (data.items ?? []));
        setError(null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '상점 조회 실패');
      } finally {
        setLoading(false);
      }
    }
    fetchStores();
  }, []);

  return { stores, loading, error };
}

export function usePublicStore(storeId: string) {
  const [detail, setDetail] = useState<PublicStoreDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId) {
      setLoading(false);
      return;
    }
    async function fetchStore() {
      try {
        const res = await fetch(`${API_URL}/public/stores/${storeId}`);
        if (!res.ok) throw new Error(`서버 오류 ${res.status}`);
        setDetail(await res.json());
        setError(null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '상점 조회 실패');
      } finally {
        setLoading(false);
      }
    }
    fetchStore();
  }, [storeId]);

  return { detail, loading, error };
}
