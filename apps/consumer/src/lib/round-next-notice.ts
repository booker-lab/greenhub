import type { SaleRound } from '@greenhub/shared';
import { formatRoundTime, isRoundOrderClosed } from '@/lib/round-schedule-label';

type RoundScheduleSource = Pick<SaleRound, 'id' | 'status' | 'schedule'>;

function futureOpenMillis(round: RoundScheduleSource, nowMillis: number): number | null {
  if (round.status !== 'SCHEDULED') return null;
  const openAt = Date.parse(round.schedule.orderOpenAt);
  return Number.isFinite(openAt) && openAt > nowMillis ? openAt : null;
}

/**
 * 홈에 보이는 회차의 주문이 끝났을 때 이어서 주문을 받을 다음 회차. 이미 받아 둔 회차 목록에서만 찾는다.
 * 판매 예정(SCHEDULED)이고 주문 시작 시각이 아직 오지 않은 회차 중 가장 먼저 열리는 것을 고른다.
 * 보이는 회차가 아직 주문을 받는 중이거나, 그런 회차가 없거나, 시작 시각을 읽을 수 없으면 null.
 */
export function findNextRoundAfterClose<T extends RoundScheduleSource>(
  rounds: readonly T[],
  current: RoundScheduleSource | null,
  nowMillis: number,
): T | null {
  if (!current || !Number.isFinite(nowMillis) || !isRoundOrderClosed(current, nowMillis)) {
    return null;
  }
  let next: T | null = null;
  let nextOpenAt = Number.POSITIVE_INFINITY;
  for (const round of rounds) {
    if (round.id === current.id) continue;
    const openAt = futureOpenMillis(round, nowMillis);
    if (openAt !== null && openAt < nextOpenAt) {
      next = round;
      nextOpenAt = openAt;
    }
  }
  return next;
}

/**
 * 다음 회차 주문 시작 안내 한 줄. 시각은 회차 일정 표기(formatRoundTime, 0시대는 전날 "밤 12시")를 그대로 쓴다.
 * 예: "다음 회차는 11월 14일(토) 오전 10시에 주문을 받아요". 시각을 읽을 수 없으면 null.
 */
export function formatNextRoundNotice(round: Pick<SaleRound, 'schedule'>): string | null {
  const time = formatRoundTime(round.schedule.orderOpenAt);
  return time ? `다음 회차는 ${time}에 주문을 받아요` : null;
}
