'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { apiJson } from '@/lib/api';
import type { Summary } from '@/app/settlements/_constants';

interface UseDashboardSummaryResult {
  summary: Summary | null;
  loading: boolean;
  error: string | null;
}

/**
 * 홈 대시보드 전용 — 오늘자 정산 summary 1회 fetch.
 * `apiJson` 사용(#CL-32 — raw fetch 금지). 날짜는 정산 페이지와 동일 기준.
 */
export function useDashboardSummary(): UseDashboardSummaryResult {
  const { data: session } = useSession();
  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;

  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId || !token) return;
    let cancelled = false;
    const today = new Date().toISOString().split('T')[0];

    setLoading(true);
    setError(null);
    apiJson<Summary>(`/stores/${storeId}/settlements/summary?date=${today}`, token)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '정산 정보를 불러오지 못했습니다');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [storeId, token]);

  return { summary, loading, error };
}
