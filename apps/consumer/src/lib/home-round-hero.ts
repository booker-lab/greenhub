import type { SaleRound } from '@greenhub/shared';
import { type CountdownTarget, countdownTarget } from '@/lib/round-countdown';
import {
  formatRoundMonthDay,
  formatRoundTime,
  isRoundOrderClosed,
} from '@/lib/round-schedule-label';

// 홈 제목 구역(docs/specs/frontend/design-direction.md §4.2 2·3번)의 상태.
// 배송일 제목 · 마감 알약 · 한 줄 단계 표시가 회차 상태마다 어떻게 줄어드는지 여기 한 곳에서 정한다.

export type HomeRoundStepKey = 'order' | 'close' | 'auction' | 'delivery';

export interface HomeRoundStep {
  key: HomeRoundStepKey;
  /** 한 줄 단계 표시에 쓰는 이름. */
  label: string;
  /** 펼치면 보이는 날짜·시각. */
  time: string;
  /** 지금 단계인지. 판매 예정 회차는 아직 어느 단계도 아니다. */
  current: boolean;
}

interface HomeRoundHeroTitle {
  /** 52px 배송일 제목. 예: "11월 17일"(자정 도착은 전날로 읽는다). */
  deliveryDate: string;
  /** "주문 — 마감 — 새벽 경매 — 문 앞" 순서. */
  steps: HomeRoundStep[];
}

export type HomeRoundHeroState =
  /** 회차가 없거나 완료·취소됐거나 도착일을 읽지 못함: 제목·알약·단계 표시 없이 안내 줄만 둔다. */
  | { kind: 'none' }
  /** 판매 예정: 알약은 주문 시작까지 센다(시작 시각을 읽지 못하면 알약 없음). */
  | ({ kind: 'scheduled'; countdown: CountdownTarget | null } & HomeRoundHeroTitle)
  /** 주문 받는 중: 알약은 마감까지 센다(마감 시각을 읽지 못하면 알약 없음). */
  | ({ kind: 'open'; countdown: CountdownTarget | null } & HomeRoundHeroTitle)
  /** 주문 마감 뒤(CLOSED이거나 마감 시각이 지난 회차): 알약이 없다. */
  | ({ kind: 'closed' } & HomeRoundHeroTitle);

const TIME_UNKNOWN = '일정 확인 중';

function readTime(value: unknown): string | null {
  // new Date(null)은 1970년으로 읽히므로 글자가 아닌 값은 먼저 거른다.
  return typeof value === 'string' ? formatRoundTime(value) : null;
}

function withSuffix(time: string | null, suffix: string): string {
  return time ? `${time}${suffix}` : TIME_UNKNOWN;
}

function readableCountdown(round: Pick<SaleRound, 'status' | 'schedule'>): CountdownTarget | null {
  const target = countdownTarget(round.status, round.schedule);
  return target && Number.isFinite(Date.parse(target.at)) ? target : null;
}

/**
 * 홈에 보이는 회차로 제목 구역의 상태를 정한다. 시각은 인자로 받는다.
 * "지금 경매 중"·"오늘 도착" 단계는 아직 나누지 않는다(주문이 끝난 뒤는 모두 마감 단계로 본다).
 */
export function homeRoundHeroState(
  round: Pick<SaleRound, 'status' | 'schedule'> | null | undefined,
  nowMillis: number,
): HomeRoundHeroState {
  if (!round?.schedule) return { kind: 'none' };
  const { status, schedule } = round;
  if (status !== 'SCHEDULED' && status !== 'OPEN' && status !== 'CLOSED') return { kind: 'none' };
  const deliveryDate =
    typeof schedule.deliveryEndAt === 'string' ? formatRoundMonthDay(schedule.deliveryEndAt) : null;
  if (!deliveryDate) return { kind: 'none' };

  const closed = isRoundOrderClosed(round, nowMillis);
  const kind = closed ? 'closed' : status === 'SCHEDULED' ? 'scheduled' : 'open';
  const closeTime = readTime(schedule.orderCloseAt);
  const steps: HomeRoundStep[] = [
    {
      key: 'order',
      label: '주문',
      time: withSuffix(readTime(schedule.orderOpenAt), '부터'),
      current: kind === 'open',
    },
    {
      key: 'close',
      label: '마감',
      // 지난 마감에는 "까지"를 붙이지 않는다(formatOrderCloseStatus와 같은 규칙).
      time: closed ? (closeTime ?? TIME_UNKNOWN) : withSuffix(closeTime, '까지'),
      current: kind === 'closed',
    },
    {
      key: 'auction',
      label: '새벽 경매',
      time: readTime(schedule.auctionAt) ?? TIME_UNKNOWN,
      current: false,
    },
    {
      key: 'delivery',
      label: '문 앞',
      time: withSuffix(readTime(schedule.deliveryEndAt), '까지'),
      current: false,
    },
  ];

  if (kind === 'closed') return { kind, deliveryDate, steps };
  return { kind, deliveryDate, steps, countdown: readableCountdown(round) };
}
