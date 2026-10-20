/**
 * 관리자 목록 조회 순서 계약 — `useAdminList`가 쓰는 순수 로더.
 * vitest에서 `@/` alias 없이 직접 검증할 수 있도록 React·next-auth 의존성을 두지 않는다.
 *
 * - 최신 요청만 화면 상태를 쓴다: 필터를 빠르게 바꿔 요청이 겹치면 늦게 도착한 옛 응답은
 *   items·error·loading을 건드리지 않고 버려진다(엉뚱한 목록·합계가 남지 않는다).
 * - 밀려난 요청의 호출자(reload를 기다리는 command 등)는 최신 요청 결과를 대신 받는다.
 * - 세션 확인 중(토큰 아직 없음)이면 로딩을 유지하고, 확인이 끝났는데 토큰이 없으면
 *   로딩을 끝내고 인증 실패를 error로 남긴다(loading이 영원히 true로 남지 않는다).
 * - 조회 실패는 이전 items를 비우지 않는다 — error 존재 자체가 실패의 증거다.
 */

import { ADMIN_COMMAND_MISSING_TOKEN_MESSAGE } from './useAdmin.outcome';

export interface AdminListSink<T> {
  setItems: (items: T[]) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export type AdminListRequest<T> =
  | { kind: 'session-pending' }
  | { kind: 'missing-token' }
  | { kind: 'fetch'; fetch: () => Promise<T[]>; errLabel: string };

/** 반환한 load는 readError(성공 시 null)를 돌려준다. */
export function createAdminListLoader<T>(sink: AdminListSink<T>) {
  let latestSeq = 0;
  let latestLoad: Promise<string | null> = Promise.resolve(null);

  const run = async (seq: number, request: AdminListRequest<T>): Promise<string | null> => {
    if (request.kind === 'session-pending') return ADMIN_COMMAND_MISSING_TOKEN_MESSAGE;
    if (request.kind === 'missing-token') {
      sink.setError(ADMIN_COMMAND_MISSING_TOKEN_MESSAGE);
      sink.setLoading(false);
      return ADMIN_COMMAND_MISSING_TOKEN_MESSAGE;
    }
    sink.setLoading(true);
    try {
      const items = await request.fetch();
      if (seq !== latestSeq) return latestLoad;
      sink.setItems(items);
      sink.setError(null);
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

  return (request: AdminListRequest<T>): Promise<string | null> => {
    latestSeq += 1;
    const load = run(latestSeq, request);
    latestLoad = load;
    return load;
  };
}
