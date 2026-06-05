'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import type { AdminStore } from '@/hooks/useAdmin';
import { apiJson } from '@/lib/api';

export interface AdminStoreOwner {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface AdminStoreSummaryBucket {
  totalCount: number;
  byStatus: Record<string, number>;
}

export interface AdminStoreSummary {
  store: AdminStore;
  owner: AdminStoreOwner | null;
  orders: AdminStoreSummaryBucket & {
    totalAmount: number;
  };
  settlements: AdminStoreSummaryBucket & {
    platformFee: number;
    netAmount: number;
  };
}

export function useAdminStoreDetail(storeId: string) {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [summary, setSummary] = useState<AdminStoreSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!token || !storeId) return;
    setLoading(true);
    try {
      const data = await apiJson<AdminStoreSummary>(`/admin/stores/${storeId}/summary`, token);
      setSummary(data);
      setError(null);
    } catch (e) {
      setSummary(null);
      setError(e instanceof Error ? e.message : '판매자 상세 조회 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [storeId, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { summary, loading, error, reload };
}
