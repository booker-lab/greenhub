/**
 * 이 기기에서 방금 완료로 수렴한 주문 기억 (R-01, DOM 없음, node:test로 검증).
 *
 * 사진으로 완료하면 사진 화면만 목록으로 바뀌고(router.replace) 그 앞의 상세 기록은 남는다. 완료 직후
 * 휴대폰 뒤로가기로 그 상세가 열리면 기사 상세 GET은 완료 주문을 404로 돌려주므로, 상세는 이 기억을 보고
 * "다른 기사가 맡았거나…" 대신 "배송을 마친 주문이에요."를 보인다.
 *
 * - 기록은 탭 세션(sessionStorage)에 잠깐(RECENT_COMPLETION_TTL_MS) 둔다. 서버 상태를 대신하지 않고
 *   404 화면 문구를 고르는 데만 쓴다.
 * - 다른 계정으로 바뀐 뒤에는 쓰지 않도록 사용자 ID를 함께 기록하고 비교한다. 사용자 ID가 없으면
 *   기록하지도 맞다고 보지도 않는다(예전 문구로 남는다).
 * - sessionStorage가 막혀 있거나(접근 자체가 예외) 값이 깨져 있으면 기록하지 않고 맞다고 보지 않는다.
 */

export const RECENT_COMPLETION_STORAGE_KEY = 'greenhub:driver:recent-completed-orders';

/** 완료 기억을 쓰는 시간(30분). 뒤로가기로 곧바로 돌아오는 경우만 덮으면 된다. */
export const RECENT_COMPLETION_TTL_MS = 30 * 60 * 1000;

/** 기억하는 주문 수 상한. 오래된 것부터 버린다. */
export const RECENT_COMPLETION_MAX_ENTRIES = 20;

export interface RecentCompletion {
  orderId: string;
  userId: string;
  completedAt: number;
}

export type RecentCompletionStorage = Pick<Storage, 'getItem' | 'setItem'>;

function isRecentCompletion(value: unknown): value is RecentCompletion {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<RecentCompletion>;
  return (
    typeof entry.orderId === 'string' &&
    entry.orderId.length > 0 &&
    typeof entry.userId === 'string' &&
    entry.userId.length > 0 &&
    typeof entry.completedAt === 'number' &&
    Number.isFinite(entry.completedAt)
  );
}

/** 기록 시각이 지금보다 뒤이거나(시계가 되돌아감) 유효 시간을 넘겼으면 쓰지 않는다. */
function isFresh(entry: RecentCompletion, now: number): boolean {
  const age = now - entry.completedAt;
  return age >= 0 && age < RECENT_COMPLETION_TTL_MS;
}

/** 저장된 문자열에서 아직 유효한 기록만 읽는다. 깨진 값·형식이 다른 항목은 버린다. */
export function readRecentCompletions(raw: string | null, now: number): RecentCompletion[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isRecentCompletion).filter((entry) => isFresh(entry, now));
}

/** 새 완료 기록을 더한 목록. 같은 주문·사용자의 이전 기록과 만료 기록은 버리고 상한까지만 남긴다. */
export function addRecentCompletion(
  entries: readonly RecentCompletion[],
  entry: RecentCompletion,
  now: number,
): RecentCompletion[] {
  const kept = entries.filter(
    (item) =>
      isFresh(item, now) && !(item.orderId === entry.orderId && item.userId === entry.userId),
  );
  return [...kept, entry].slice(-RECENT_COMPLETION_MAX_ENTRIES);
}

/** 이 사용자가 이 주문을 방금(유효 시간 안에) 완료했는가. 주문·사용자 ID가 없으면 false다. */
export function isRecentlyCompletedOrder(
  entries: readonly RecentCompletion[],
  target: { orderId: string | null | undefined; userId: string | null | undefined },
  now: number,
): boolean {
  if (!target.orderId || !target.userId) return false;
  return entries.some(
    (entry) =>
      entry.orderId === target.orderId && entry.userId === target.userId && isFresh(entry, now),
  );
}

function browserSessionStorage(): RecentCompletionStorage | null {
  if (typeof window === 'undefined') return null;
  // 접근 자체가 SecurityError를 던질 수 있으므로 호출자의 try 안에서만 부른다.
  return window.sessionStorage;
}

/**
 * 방금 완료로 수렴한 주문을 기록한다. 사진 화면이 완료(정상 ACK·서버가 이미 완료)로 수렴해 목록으로
 * 옮기기 직전에 부른다. 기록하지 못하면(사용자 ID 없음·저장소 막힘) false이고 화면 흐름은 그대로다.
 */
export function rememberCompletedOrder(args: {
  orderId: string;
  userId: string | null | undefined;
  now?: number;
  storage?: RecentCompletionStorage | null;
}): boolean {
  if (!args.orderId || !args.userId) return false;
  try {
    const storage = args.storage === undefined ? browserSessionStorage() : args.storage;
    if (!storage) return false;
    const now = args.now ?? Date.now();
    const next = addRecentCompletion(
      readRecentCompletions(storage.getItem(RECENT_COMPLETION_STORAGE_KEY), now),
      { orderId: args.orderId, userId: args.userId, completedAt: now },
      now,
    );
    storage.setItem(RECENT_COMPLETION_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** 이 사용자가 이 기기에서 이 주문을 방금 완료했다고 기록돼 있는가. 읽지 못하면 false(예전 문구)다. */
export function wasOrderRecentlyCompleted(args: {
  orderId: string;
  userId: string | null | undefined;
  now?: number;
  storage?: RecentCompletionStorage | null;
}): boolean {
  if (!args.orderId || !args.userId) return false;
  try {
    const storage = args.storage === undefined ? browserSessionStorage() : args.storage;
    if (!storage) return false;
    const now = args.now ?? Date.now();
    return isRecentlyCompletedOrder(
      readRecentCompletions(storage.getItem(RECENT_COMPLETION_STORAGE_KEY), now),
      { orderId: args.orderId, userId: args.userId },
      now,
    );
  } catch {
    return false;
  }
}
