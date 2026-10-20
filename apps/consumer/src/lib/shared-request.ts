/**
 * 공개 조회 요청 공유.
 *
 * 하단 메뉴·홈·카테고리 화면이 같은 화면 안에서 같은 공개 API(활성 상품 목록, 매장 공개
 * 프로필)를 각자 불러 한 번 들어올 때 같은 요청이 2~3번 나갔다. 같은 키의 요청을 잠깐
 * 공유해 한 번만 보낸다.
 *
 * - 실패한 요청은 공유하지 않는다(바로 지워 다음 호출이 다시 보낸다).
 * - fresh=true(화면의 다시 불러오기)는 공유된 결과를 쓰지 않고 새로 보낸다.
 * - 결과 객체는 여러 화면이 함께 받으므로 호출부가 고치지 않는다(필요하면 복사한다).
 * - 공유 기간이 지난 항목은 다음 호출 때 지우고, 항목 수는 MAX_ENTRIES를 넘지 않게
 *   가장 오래 전에 넣은 것부터 지운다(매장 프로필처럼 키가 늘어나는 조회 대비).
 */

type Entry = { promise: Promise<unknown>; expiresAt: number };

/** 공유 항목 수 상한. 넘으면 가장 오래 전에 넣은 항목부터 지운다. */
export const MAX_ENTRIES = 100;

const entries = new Map<string, Entry>();

function pruneExpired(now: number): void {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
}

export function sharedRequest<T>(
  key: string,
  load: () => Promise<T>,
  options: { ttlMs: number; fresh?: boolean; now?: () => number },
): Promise<T> {
  const now = options.now?.() ?? Date.now();
  pruneExpired(now);
  const hit = entries.get(key);
  if (!options.fresh && hit) return hit.promise as Promise<T>;

  const promise = Promise.resolve().then(load);
  const entry: Entry = { promise, expiresAt: now + options.ttlMs };
  // 다시 넣는 키도 "가장 최근"이 되도록 지운 뒤 넣는다(Map은 넣은 순서를 지킨다).
  entries.delete(key);
  entries.set(key, entry);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  promise.catch(() => {
    if (entries.get(key) === entry) entries.delete(key);
  });
  return promise;
}

/** 테스트 전용: 지금 공유 중인 항목 수. */
export function sharedRequestCount(): number {
  return entries.size;
}

/** 테스트 전용: 공유 중인 요청을 모두 비운다. */
export function clearSharedRequests(): void {
  entries.clear();
}
