'use client';

import { useSession } from 'next-auth/react';
import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import { apiJson } from '@/lib/api';
import { type AdminCommandOutcome, executeAdminCommand } from './useAdmin.outcome';

// ── Core ─────────────────────────────────────────────────────────

/**
 * 관리자 목록 리소스 공통 훅 — data/loading/error 상태 + 토큰 가드 + 자동 로드.
 * `buildPath`/`extract`는 매 렌더 재생성되므로 deps에 넣지 않는다(필터값만 deps로).
 */
export function useAdminList<T>(
  buildPath: () => string,
  extract: (data: unknown) => T[],
  errLabel: string,
  deps: DependencyList = [],
) {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 필터를 빠르게 바꾸면 늦게 온 이전 응답이 최신 결과를 덮을 수 있다 — 마지막 요청 응답만 반영한다.
  const requestIdRef = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: buildPath/extract/errLabel은 매 렌더 재생성되는 안정 클로저 — reload는 token·필터(deps) 변화로만 트리거한다
  const load = useCallback(async (): Promise<string | null> => {
    const requestId = ++requestIdRef.current;
    const isLatest = () => requestId === requestIdRef.current;
    if (!token) return '인증 토큰이 없습니다. 다시 로그인해 주세요.';
    setLoading(true);
    try {
      const data = await apiJson(buildPath(), token);
      if (isLatest()) {
        setItems(extract(data));
        setError(null);
      }
      return null;
    } catch {
      const readError = `${errLabel} 조회 중 오류 발생`;
      if (isLatest()) setError(readError);
      return readError;
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [token, ...deps]);

  useEffect(() => {
    load();
  }, [load]);

  return { items, loading, error, reload: load, token };
}

/**
 * 관리자 액션(PATCH/POST/PUT) 실행 — boolean 축약 없이 outcome으로 반환한다.
 * - 2xx + reload 성공: confirmed/reconciled.
 * - 2xx + reload 실패: confirmed/stale (command 실패로 되돌리지 않음, readError 보존).
 * - 4xx ApiError: rejected (서버 reason/status 보존).
 * - 5xx ApiError·transport: unknown (재확인 우선, blind retry 금지).
 * reload 실패는 기존 list error state에도 남는다 (load가 소유).
 */
export async function runAdminCommand(
  token: string | undefined,
  path: string,
  options: RequestInit,
  reload: () => Promise<string | null>,
): Promise<AdminCommandOutcome> {
  return executeAdminCommand({
    missingToken: !token,
    invoke: () => apiJson(path, token as string, options).then(() => undefined),
    reload,
  });
}

export function withQuery(base: string, params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  const str = qs.toString();
  return str ? `${base}?${str}` : base;
}

export function pick<T>(key: string) {
  return (data: unknown): T[] => (data as Record<string, T[]>)?.[key] ?? [];
}
