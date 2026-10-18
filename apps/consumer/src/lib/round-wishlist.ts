// 이번 회차 찜(wishlist, 벤치마킹 비교 기능). 서버에 남기지 않고 고객 브라우저에 회차별로만 둔다.
// 다른 회차의 찜은 읽거나 쓸 때 지운다. 다음 회차 소식은 "다음 회차 알림 신청"과 카카오 채널로 받는다.

export const ROUND_WISH_KEY_PREFIX = 'greenhub_round_wish:';
export const ROUND_WISH_MAX = 50;
export const ROUND_WISH_CHANGE_EVENT = 'greenhub-round-wish-change';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export function roundWishKey(roundId: string): string {
  return `${ROUND_WISH_KEY_PREFIX}${roundId}`;
}

/** 이 회차가 아닌 찜 기록을 지운다. */
export function clearOtherRoundWishes(storage: StorageLike, roundId: string): void {
  const keep = roundWishKey(roundId);
  const stale: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(ROUND_WISH_KEY_PREFIX) && key !== keep) stale.push(key);
  }
  for (const key of stale) storage.removeItem(key);
}

export function readRoundWish(storage: StorageLike | null, roundId: string | null): string[] {
  if (!storage || !roundId) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(roundWishKey(roundId)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(
      0,
      ROUND_WISH_MAX,
    );
  } catch {
    return [];
  }
}

/** 찜을 켜고 끈 뒤의 목록. 저장에 실패해도(사생활 보호 모드 등) 화면 상태는 돌려준다. */
export function toggleRoundWish(storage: StorageLike | null, roundId: string, productId: string): string[] {
  const current = readRoundWish(storage, roundId);
  const next = current.includes(productId)
    ? current.filter((id) => id !== productId)
    : [productId, ...current].slice(0, ROUND_WISH_MAX);
  if (storage) {
    try {
      clearOtherRoundWishes(storage, roundId);
      if (next.length === 0) storage.removeItem(roundWishKey(roundId));
      else storage.setItem(roundWishKey(roundId), JSON.stringify(next));
    } catch {
      /* 저장 실패는 무시한다 */
    }
  }
  return next;
}
