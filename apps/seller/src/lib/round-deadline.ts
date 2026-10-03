import type { SaleRound } from '@greenhub/shared';

// 판매자 화면의 노란 마감 띠 계산. 규칙은 소비자 앱 lib/round-countdown.ts와 같다
// (판매 중이면 주문 마감까지, 판매 예정이면 주문 시작까지). 문구에는 회차 상태 이름
// ("판매 중"·"주문 마감" 등)을 쓰지 않는다 — 회차 상세 E2E가 상태 글자를 한 곳에서만 찾는다.

export type DeadlineRound = Pick<SaleRound, 'id' | 'name' | 'status' | 'schedule'>;

export interface DeadlineTarget {
  label: string;
  at: string;
}

/** 판매 중이면 주문 마감까지, 판매 예정이면 주문 시작까지 센다. 그 밖의 상태는 띠를 숨긴다. */
export function deadlineTarget(round: DeadlineRound): DeadlineTarget | null {
  if (round.status === 'OPEN') return { label: '마감까지', at: round.schedule.orderCloseAt };
  if (round.status === 'SCHEDULED')
    return { label: '주문 시작까지', at: round.schedule.orderOpenAt };
  return null;
}

/** 띠에 보일 회차: 판매 중 회차가 있으면 그것(마감이 가장 이른 것), 없으면 주문 시작이 가장 이른 판매 예정 회차. */
export function pickDeadlineRound<T extends DeadlineRound>(rounds: readonly T[]): T | null {
  const earliest = (list: T[], key: 'orderCloseAt' | 'orderOpenAt') =>
    list.reduce<T | null>(
      (best, round) =>
        best === null || Date.parse(round.schedule[key]) < Date.parse(best.schedule[key])
          ? round
          : best,
      null,
    );
  return (
    earliest(
      rounds.filter((round) => round.status === 'OPEN'),
      'orderCloseAt',
    ) ??
    earliest(
      rounds.filter((round) => round.status === 'SCHEDULED'),
      'orderOpenAt',
    )
  );
}

const pad = (value: number) => String(value).padStart(2, '0');

/** 예: "2일 14:32:07", "03:05:09". 이미 지났거나 잘못된 값이면 "00:00:00". */
export function formatCountdown(remainingMs: number): string {
  const total = Number.isFinite(remainingMs) ? Math.max(0, Math.floor(remainingMs / 1000)) : 0;
  const days = Math.floor(total / 86_400);
  const clock = `${pad(Math.floor((total % 86_400) / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return days > 0 ? `${days}일 ${clock}` : clock;
}
