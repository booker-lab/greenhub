'use client';

import { useSession } from 'next-auth/react';
import { type DependencyList, useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import { createAdminListLoader } from './useAdmin.loader';
import { type AdminCommandOutcome, executeAdminCommand } from './useAdmin.outcome';

// ── Core ─────────────────────────────────────────────────────────

/**
 * 관리자 목록 리소스 공통 훅 — data/loading/error 상태 + 토큰 가드 + 자동 로드.
 * `buildPath`/`extract`는 매 렌더 재생성되므로 deps에 넣지 않는다(필터값만 deps로).
 * 응답 순서·토큰 없음 처리는 순수 로더(`useAdmin.loader`)가 소유한다:
 * 늦게 온 옛 응답은 최신 결과를 덮지 않고, 세션 확인이 끝났는데 토큰이 없으면 로딩을 끝낸다.
 */
export function useAdminList<T>(
  buildPath: () => string,
  extract: (data: unknown) => T[],
  errLabel: string,
  deps: DependencyList = [],
) {
  const { data: session, status } = useSession();
  const token = session?.user.accessToken;
  const sessionPending = status === 'loading';
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // useState setter는 안정 참조라 로더를 한 번만 만든다(요청 순번이 렌더 사이에 유지된다).
  const [runLoad] = useState(() => createAdminListLoader<T>({ setItems, setError, setLoading }));

  // biome-ignore lint/correctness/useExhaustiveDependencies: buildPath/extract/errLabel은 매 렌더 재생성되는 안정 클로저 — reload는 token·세션 상태·필터(deps) 변화로만 트리거한다
  const load = useCallback((): Promise<string | null> => {
    if (!token) return runLoad({ kind: sessionPending ? 'session-pending' : 'missing-token' });
    return runLoad({
      kind: 'fetch',
      fetch: async () => extract(await apiJson(buildPath(), token)),
      errLabel,
    });
  }, [token, sessionPending, runLoad, ...deps]);

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
