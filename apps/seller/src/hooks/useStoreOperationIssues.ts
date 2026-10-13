'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import {
  attachManualResolutions,
  isValidManualResolveMemo,
  normalizeManualResolveMemo,
  type StoreOperationIssue,
} from '@/app/operations/manual-resolve';
import { readStoreOperationIssueList } from '@/app/orders/[id]/operation-issues';
import { apiJson } from '@/lib/api';

// 가게 전체 운영 기록(환불·결제·연락·사진 확인 필요 등). 환불 재시도·문자 재발송은 주문 상세에서 하고,
// 자동으로 닫히지 않는 기록은 여기서 메모와 함께 "해결로 닫기"를 한다.
export function useStoreOperationIssues() {
  const { data: session } = useSession();
  const storeId = session?.user.storeId ?? null;
  const token = session?.user.accessToken ?? '';
  const role = session?.user.role ?? null;
  const [issues, setIssues] = useState<StoreOperationIssue[]>([]);
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
      setIssues(attachManualResolutions(payload, readStoreOperationIssueList(payload, storeId)));
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

  /** 메모와 함께 기록을 닫고 목록을 다시 읽는다. 실패하면 서버 메시지를 담은 오류를 던진다. */
  const resolveIssue = useCallback(
    async (issue: StoreOperationIssue, memo: string) => {
      if (!storeId || !token || issue.storeId !== storeId) {
        throw new Error('로그인 정보를 확인할 수 없어요. 다시 로그인해 주세요.');
      }
      if (!isValidManualResolveMemo(memo)) {
        throw new Error('닫는 이유를 200자 안으로 적어 주세요.');
      }
      await apiJson(
        `/stores/${encodeURIComponent(storeId)}/operation-issues/${encodeURIComponent(issue.id)}/resolve`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({ memo: normalizeManualResolveMemo(memo) }),
        },
      );
      await reload();
    },
    [reload, storeId, token],
  );

  const openIssues = issues.filter((issue) => issue.status === 'OPEN');
  return { issues, openIssues, loading, error, hasLoaded, reload, resolveIssue, role };
}
