'use client';

import type { OperationIssueActionType } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import {
  getAllowedOperationAction,
  type OrderOperationIssue,
  readOperationIssue,
  readOperationIssueList,
} from '../operation-issues';

interface UseOrderOperationsResult {
  issues: OrderOperationIssue[];
  loading: boolean;
  actionIssueId: string | null;
  error: string | null;
  reload: () => Promise<void>;
  executeAction: (issue: OrderOperationIssue) => Promise<void>;
}

function readExpectedIssue(
  payload: unknown,
  expected: { storeId: string; orderId: string; issueId: string },
) {
  const issue = readOperationIssue(payload);
  if (
    !issue ||
    issue.id !== expected.issueId ||
    issue.storeId !== expected.storeId ||
    issue.orderId !== expected.orderId
  ) {
    throw new Error('운영 기록 응답이 현재 주문과 일치하지 않습니다.');
  }
  return issue;
}

export function useOrderOperations(
  storeId: string | null,
  orderId: string,
): UseOrderOperationsResult {
  const { data: session } = useSession();
  const token = session?.user.accessToken ?? '';
  const [issues, setIssues] = useState<OrderOperationIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionIssueId, setActionIssueId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const replaceIssue = useCallback((next: OrderOperationIssue) => {
    setIssues((current) =>
      current
        .map((issue) => (issue.id === next.id ? next : issue))
        .sort((left, right) => {
          if (left.status === 'OPEN' && right.status !== 'OPEN') return -1;
          if (left.status !== 'OPEN' && right.status === 'OPEN') return 1;
          return right.updatedAt.localeCompare(left.updatedAt);
        }),
    );
  }, []);

  const reload = useCallback(async () => {
    if (!storeId || !orderId || !token) {
      setIssues([]);
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
      setIssues(readOperationIssueList(payload, { storeId, orderId }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '운영 기록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [orderId, storeId, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const executeAction = useCallback(
    async (issue: OrderOperationIssue) => {
      if (!storeId || !token || issue.orderId !== orderId) return;
      const actionType = getAllowedOperationAction(issue);
      if (!actionType) return;
      const basePath = `/stores/${encodeURIComponent(storeId)}/operation-issues/${encodeURIComponent(issue.id)}`;
      setActionIssueId(issue.id);
      setError(null);
      try {
        const refreshedPayload = await apiJson(`${basePath}/refresh`, token, { method: 'POST' });
        const refreshed = readExpectedIssue(refreshedPayload, {
          storeId,
          orderId,
          issueId: issue.id,
        });
        replaceIssue(refreshed);

        if (getAllowedOperationAction(refreshed) !== actionType) {
          setError('최신 상태에서 더 이상 실행할 수 없는 조치입니다.');
          return;
        }

        const resultPayload = await apiJson(`${basePath}/actions`, token, {
          method: 'POST',
          body: JSON.stringify({ actionType } satisfies {
            actionType: OperationIssueActionType;
          }),
        });
        replaceIssue(
          readExpectedIssue(resultPayload, {
            storeId,
            orderId,
            issueId: issue.id,
          }),
        );
      } catch (caught) {
        try {
          const latestPayload = await apiJson(basePath, token);
          replaceIssue(
            readExpectedIssue(latestPayload, {
              storeId,
              orderId,
              issueId: issue.id,
            }),
          );
        } catch {
          // 원래 조치 오류를 보존한다.
        }
        setError(caught instanceof Error ? caught.message : '운영 조치를 실행하지 못했습니다.');
      } finally {
        setActionIssueId(null);
      }
    },
    [orderId, replaceIssue, storeId, token],
  );

  return { issues, loading, actionIssueId, error, reload, executeAction };
}
