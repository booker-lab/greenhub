/**
 * 관리자 목록 "더 보기"(커서 이어받기) 순서 계약 — `useAdminPagedList`가 쓰는 순수 로더.
 * vitest에서 `@/` alias 없이 직접 검증할 수 있도록 React·next-auth 의존성을 두지 않는다.
 *
 * - 첫 쪽(load)은 `createAdminListLoader`와 같은 규칙을 따른다: 최신 요청만 화면 상태를 쓰고,
 *   밀려난 호출자는 최신 요청 결과를 대신 받으며, 토큰이 없으면 로딩을 끝내고 error를 남긴다.
 * - 더 보기(loadMore)는 마지막으로 받은 nextCursor로 다음 쪽을 이어 붙인다. 그 사이 필터가 바뀌거나
 *   다시 조회(load)되면 늦게 온 다음 쪽은 버린다(다른 조건의 목록에 섞이지 않는다).
 * - 더 보기는 한 번에 하나만 보낸다(같은 커서로 두 번 붙지 않는다).
 * - 더 보기 실패는 이미 받은 목록과 첫 쪽 error를 건드리지 않고 moreError에만 남긴다
 *   (목록은 그대로 보이고, 더 보기 버튼 곁에서 다시 시도한다).
 */

import { ADMIN_COMMAND_MISSING_TOKEN_MESSAGE } from './useAdmin.outcome';

export interface AdminPage<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface AdminPagedSink<T> {
  setItems: (items: T[]) => void;
  setHasMore: (hasMore: boolean) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  setLoadingMore: (loadingMore: boolean) => void;
  setMoreError: (error: string | null) => void;
}

export type AdminPagedRequest<T> =
  | { kind: 'session-pending' }
  | { kind: 'missing-token' }
  | {
      kind: 'fetch';
      fetchPage: (cursor: string | null) => Promise<AdminPage<T>>;
      errLabel: string;
    };

/** 서버 응답에서 한 쪽을 읽는다. hasMore·nextCursor가 없으면(옛 응답) 더 없음으로 본다. */
export function readAdminPage<T>(data: unknown, key: string): AdminPage<T> {
  const body = (data ?? {}) as { hasMore?: unknown; nextCursor?: unknown } & Record<
    string,
    unknown
  >;
  const items = Array.isArray(body[key]) ? (body[key] as T[]) : [];
  const nextCursor = typeof body.nextCursor === 'string' ? body.nextCursor : null;
  return { items, hasMore: body.hasMore === true && nextCursor !== null, nextCursor };
}

export function createAdminPagedLoader<T>(sink: AdminPagedSink<T>) {
  let latestSeq = 0;
  let latestLoad: Promise<string | null> = Promise.resolve(null);
  let items: T[] = [];
  let cursor: string | null = null;
  let hasMore = false;
  let fetchPage: ((cursor: string | null) => Promise<AdminPage<T>>) | null = null;
  let errLabel = '';
  let moreInFlight = false;

  const apply = (page: AdminPage<T>, append: boolean) => {
    items = append ? [...items, ...page.items] : page.items;
    cursor = page.nextCursor;
    hasMore = page.hasMore;
    sink.setItems(items);
    sink.setHasMore(hasMore);
    sink.setMoreError(null);
    if (!append) sink.setError(null);
  };

  const run = async (seq: number, request: AdminPagedRequest<T>): Promise<string | null> => {
    if (request.kind === 'session-pending') return ADMIN_COMMAND_MISSING_TOKEN_MESSAGE;
    if (request.kind === 'missing-token') {
      sink.setError(ADMIN_COMMAND_MISSING_TOKEN_MESSAGE);
      sink.setLoading(false);
      return ADMIN_COMMAND_MISSING_TOKEN_MESSAGE;
    }
    fetchPage = request.fetchPage;
    errLabel = request.errLabel;
    sink.setLoading(true);
    try {
      const page = await request.fetchPage(null);
      if (seq !== latestSeq) return latestLoad;
      apply(page, false);
      return null;
    } catch {
      if (seq !== latestSeq) return latestLoad;
      const readError = `${request.errLabel} 조회 중 오류 발생`;
      sink.setError(readError);
      return readError;
    } finally {
      if (seq === latestSeq) sink.setLoading(false);
    }
  };

  const load = (request: AdminPagedRequest<T>): Promise<string | null> => {
    latestSeq += 1;
    // 새 조건의 첫 쪽이 오기 전에는 옛 목록의 커서로 더 보기를 보내지 않는다.
    cursor = null;
    hasMore = false;
    sink.setHasMore(false);
    sink.setMoreError(null);
    const pending = run(latestSeq, request);
    latestLoad = pending;
    return pending;
  };

  /** 다음 쪽을 붙인다. 더 받을 쪽이 없거나 이미 받는 중이면 아무것도 하지 않는다. */
  const loadMore = async (): Promise<string | null> => {
    if (!hasMore || cursor === null || fetchPage === null || moreInFlight) return null;
    const seq = latestSeq;
    const label = errLabel;
    moreInFlight = true;
    sink.setLoadingMore(true);
    try {
      const page = await fetchPage(cursor);
      if (seq !== latestSeq) return null;
      apply(page, true);
      return null;
    } catch {
      if (seq !== latestSeq) return null;
      const readError = `${label} 더 보기 중 오류 발생`;
      sink.setMoreError(readError);
      return readError;
    } finally {
      moreInFlight = false;
      sink.setLoadingMore(false);
    }
  };

  return { load, loadMore };
}
