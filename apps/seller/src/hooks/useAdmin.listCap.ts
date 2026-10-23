/**
 * 상한이 있는 관리자 목록(초대 내역·숨긴 후기) 응답 읽기 — 순수 함수.
 * vitest에서 `@/` alias 없이 직접 검증할 수 있도록 framework 의존성을 두지 않는다.
 *
 * API는 `{ [key]: 목록, hasMore, limit }`를 준다. hasMore가 true면 최근 limit건만 담긴 것이다.
 * 배포 순서가 엇갈려 옛 API(배열 그대로)가 오더라도 목록은 그대로 보여 준다(상한 안내만 없음).
 */

export interface CappedList<T> {
  items: T[];
  /** 상한에 닿아 일부만 받았으면 그 상한 건수, 아니면 null. */
  cap: number | null;
}

export function readCappedList<T>(data: unknown, key: string): CappedList<T> {
  if (Array.isArray(data)) return { items: data as T[], cap: null };
  if (typeof data !== 'object' || data === null) return { items: [], cap: null };
  const record = data as Record<string, unknown>;
  const list = record[key];
  const items = Array.isArray(list) ? (list as T[]) : [];
  const limit = record.limit;
  const cap =
    record.hasMore === true && typeof limit === 'number' && Number.isInteger(limit) && limit > 0
      ? limit
      : null;
  return { items, cap };
}

/** 상한 안내 문구. */
export function describeListCap(cap: number): string {
  return `최근 ${cap}건만 보여요.`;
}
