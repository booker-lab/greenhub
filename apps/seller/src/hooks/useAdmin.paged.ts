'use client';

import { useSession } from 'next-auth/react';
import { type DependencyList, useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import { createAdminPagedLoader, readAdminPage } from './useAdmin.pager';

/**
 * 관리자 목록 "더 보기" 공통 훅 — `useAdminList`와 같은 상태(items·loading·error·reload·token)에
 * hasMore·loadingMore·loadMore를 더한다. 응답 순서·커서 규칙은 순수 로더(`useAdmin.pager`)가 소유한다.
 * `buildPath(cursor)`는 매 렌더 재생성되므로 deps에 넣지 않는다(필터값만 deps로).
 * reload(필터 변경·명령 뒤 재조회 포함)는 첫 쪽부터 다시 받는다.
 */
export function useAdminPagedList<T>(
  buildPath: (cursor: string | null) => string,
  key: string,
  errLabel: string,
  deps: DependencyList = [],
) {
  const { data: session, status } = useSession();
  const token = session?.user.accessToken;
  const sessionPending = status === 'loading';
  const [items, setItems] = useState<T[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  // useState setter는 안정 참조라 로더를 한 번만 만든다(요청 순번·커서가 렌더 사이에 유지된다).
  const [pager] = useState(() =>
    createAdminPagedLoader<T>({
      setItems,
      setHasMore,
      setError,
      setLoading,
      setLoadingMore,
      setMoreError,
    }),
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: buildPath/key/errLabel은 매 렌더 재생성되는 안정 클로저 — reload는 token·세션 상태·필터(deps) 변화로만 트리거한다
  const load = useCallback((): Promise<string | null> => {
    if (!token) return pager.load({ kind: sessionPending ? 'session-pending' : 'missing-token' });
    return pager.load({
      kind: 'fetch',
      fetchPage: async (cursor) => readAdminPage<T>(await apiJson(buildPath(cursor), token), key),
      errLabel,
    });
  }, [token, sessionPending, pager, ...deps]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    items,
    hasMore,
    loading,
    loadingMore,
    error,
    moreError,
    reload: load,
    loadMore: pager.loadMore,
    token,
  };
}
