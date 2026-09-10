'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { todayKST } from '@greenhub/shared';
import type { Summary } from '@/app/settlements/_constants';
import { apiJson } from '@/lib/api';
import {
  buildDashboardSummaryPath,
  DASHBOARD_SUMMARY_AUTH_ERROR,
  DASHBOARD_SUMMARY_INVALID_RESPONSE_ERROR,
  DASHBOARD_SUMMARY_READ_ERROR,
  isDashboardSummaryBackgroundRefresh,
  isDashboardSummaryStale,
  parseDashboardSummaryPayload,
  resolveDashboardSummaryAuthState,
  shouldIgnoreDashboardSummaryResponse,
} from './useDashboardSummary.recovery';

export {
  buildDashboardSummaryPath,
  DASHBOARD_SUMMARY_AUTH_ERROR,
  DASHBOARD_SUMMARY_INVALID_RESPONSE_ERROR,
  DASHBOARD_SUMMARY_READ_ERROR,
  isDashboardSummaryBackgroundRefresh,
  isDashboardSummaryStale,
  isValidDashboardSummaryPayload,
  nextDashboardSummaryRetryKey,
  parseDashboardSummaryPayload,
  resolveDashboardSummaryAmountText,
  resolveDashboardSummaryAuthState,
  resolveDashboardSummaryView,
  shouldIgnoreDashboardSummaryResponse,
  shouldInvalidateDashboardSummaryScope,
} from './useDashboardSummary.recovery';
export type {
  DashboardSummaryAuthState,
  DashboardSummaryData,
  DashboardSummaryView,
} from './useDashboardSummary.recovery';

interface UseDashboardSummaryResult {
  summary: Summary | null;
  loading: boolean;
  error: string | null;
  /** 현재 scope에서 검증된 summary를 1회 이상 수신했는지. 0원 성공도 true. */
  hasLoaded: boolean;
  /** 이전 성공 summary + 최신 확인 실패. 최신 확정값이 아니다. */
  isStale: boolean;
  /** 같은 scope를 다시 조회한다. 이전 성공 summary를 지우지 않는다. */
  retry: () => void;
}

/**
 * 홈 대시보드 전용 — 오늘자 정산 summary fetch + read recovery.
 * `apiJson` 사용(#CL-32 — raw fetch 금지). 날짜는 정산 페이지와 동일하게 `todayKST()` 기준.
 *
 * 계약:
 * - 첫 성공 전 실패는 0원·empty로 표시하지 않고 error + retry로 닫는다.
 * - 이전 성공 뒤 재조회 실패는 이전 금액을 stale로 보존한다.
 * - scope(storeId) 변경 시 이전 store summary를 새 scope 값처럼 노출하지 않는다.
 * - 늦은 이전 요청이 새로운 scope/retry 결과를 덮지 않는다.
 * - 잘못된 응답 객체를 0원 summary로 렌더하지 않는다.
 */
export function useDashboardSummary(): UseDashboardSummaryResult {
  const { data: session, status: sessionStatus } = useSession();
  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;
  const normalizedStoreId = storeId ?? null;

  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [scope, setScope] = useState<string | null>(normalizedStoreId);
  const scopeRef = useRef<string | null>(normalizedStoreId);
  const requestIdRef = useRef(0);
  const hasLoadedRef = useRef(false);

  // Scope 변경(A→B, A→null, null→A)이면 이전 store summary를
  // 새 scope의 authoritative data처럼 노출하지 않도록 렌더 단계에서 무효화한다.
  if (scope !== normalizedStoreId) {
    scopeRef.current = normalizedStoreId;
    hasLoadedRef.current = false;
    requestIdRef.current += 1;
    setScope(normalizedStoreId);
    setSummary(null);
    setError(null);
    setHasLoaded(false);
    setLoading(true);
  }

  const retry = useCallback(() => {
    setRetryKey((key) => key + 1);
  }, []);

  const today = todayKST();

  useEffect(() => {
    void retryKey;
    void today;
    const authState = resolveDashboardSummaryAuthState(sessionStatus, storeId, token);
    if (authState === 'loading') {
      if (!isDashboardSummaryBackgroundRefresh(hasLoadedRef.current)) {
        setLoading(true);
      }
      return;
    }
    if (authState === 'missing') {
      requestIdRef.current += 1;
      hasLoadedRef.current = false;
      scopeRef.current = normalizedStoreId;
      setSummary(null);
      setHasLoaded(false);
      setError(DASHBOARD_SUMMARY_AUTH_ERROR);
      setLoading(false);
      return;
    }

    const requestStoreId = storeId as string;
    const requestToken = token as string;
    scopeRef.current = requestStoreId;
    // 같은 scope retry는 이전 summary를 유지한 채 background 갱신한다.
    setLoading(true);
    setError(null);
    const myId = requestIdRef.current + 1;
    requestIdRef.current = myId;
    const requestDate = todayKST();
    const path = buildDashboardSummaryPath(requestStoreId, requestDate);
    let active = true;

    apiJson<unknown>(path, requestToken)
      .then((payload) => {
        if (shouldIgnoreDashboardSummaryResponse(active, requestIdRef.current, myId)) return;
        if (scopeRef.current !== requestStoreId) return;
        const parsed = parseDashboardSummaryPayload(payload);
        hasLoadedRef.current = true;
        setSummary(parsed as unknown as Summary);
        setHasLoaded(true);
        setError(null);
      })
      .catch((e) => {
        if (shouldIgnoreDashboardSummaryResponse(active, requestIdRef.current, myId)) return;
        if (scopeRef.current !== requestStoreId) return;
        // 이전 성공 summary가 있으면 유지하고 오류만 기록한다 (stale).
        // 첫 실패는 summary null을 유지해 0원으로 승격하지 않는다.
        if (e instanceof Error && e.message === DASHBOARD_SUMMARY_INVALID_RESPONSE_ERROR) {
          setError(e.message);
        } else {
          setError(e instanceof Error ? e.message : DASHBOARD_SUMMARY_READ_ERROR);
        }
      })
      .finally(() => {
        if (shouldIgnoreDashboardSummaryResponse(active, requestIdRef.current, myId)) return;
        if (scopeRef.current !== requestStoreId) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [sessionStatus, storeId, token, retryKey, today, normalizedStoreId]);

  const isStale = isDashboardSummaryStale(error, hasLoaded);

  return { summary, loading, error, hasLoaded, isStale, retry };
}
