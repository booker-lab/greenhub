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
 */

type Entry = { promise: Promise<unknown>; expiresAt: number };

const entries = new Map<string, Entry>();

export function sharedRequest<T>(
  key: string,
  load: () => Promise<T>,
  options: { ttlMs: number; fresh?: boolean; now?: () => number },
): Promise<T> {
  const now = options.now?.() ?? Date.now();
  const hit = entries.get(key);
  if (!options.fresh && hit && hit.expiresAt > now) return hit.promise as Promise<T>;

  const promise = Promise.resolve().then(load);
  const entry: Entry = { promise, expiresAt: now + options.ttlMs };
  entries.set(key, entry);
  promise.catch(() => {
    if (entries.get(key) === entry) entries.delete(key);
  });
  return promise;
}

/** 테스트 전용: 공유 중인 요청을 모두 비운다. */
export function clearSharedRequests(): void {
  entries.clear();
}
