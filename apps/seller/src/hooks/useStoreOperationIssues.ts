'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import {
  type OrderOperationIssue,
  readStoreOperationIssueList,
} from '@/app/orders/[id]/operation-issues';
import { apiJson } from '@/lib/api';

// 가게 전체 운영 기록(환불·결제·연락·사진 확인 필요 등). 조회 전용이며 조치는 주문 상세에서 한다.
export function useStoreOperationIssues() {
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? null;
  const token = session?.user.accessToken ?? '';
  const [issues, setIssues] = useState<OrderOperationIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!storeId || !token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = await apiJson(
        `/stores/${encodeURIComponent(storeId)}/operation-issues`,
        token,
      );
      setIssues(readStoreOperationIssueList(payload, storeId));
      setHasLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '운영 기록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [storeId, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openIssues = issues.filter((issue) => issue.status === 'OPEN');
  return { issues, openIssues, loading, error, hasLoaded, reload };
}
