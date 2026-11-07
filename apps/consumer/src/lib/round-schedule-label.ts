import type { SaleRound, SaleRoundStatus } from '@greenhub/shared';

// 회차 일정 문구. 모두 한국시간 기준이며, 자정(00:00)과 0시대(00:01~00:59)는 전날 "밤 12시", "밤 12시 44분"으로
// 읽히게 표기한다("오전 12시 44분"은 낮 12시와 헷갈리고, 같은 날짜에 "밤 12시"를 붙이면 하루 뒤 자정과 겹친다).
const KST_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_MS = 24 * 60 * 60 * 1000;

function kstParts(date: Date) {
  const parts = Object.fromEntries(
    KST_PARTS.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()],
  };
}

/**
 * 예: "11월 1일(일) 오전 10시", "11월 8일(일) 밤 12시"(11월 9일 00:00), "11월 8일(일) 밤 12시 44분"(11월 9일 00:44).
 * 잘못된 값이면 null.
 */
export function formatRoundTime(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const at = kstParts(date);
  const minute = at.minute > 0 ? ` ${at.minute}분` : '';
  if (at.hour === 0) {
    const previous = kstParts(new Date(date.getTime() - DAY_MS));
    return `${previous.month}월 ${previous.day}일(${previous.weekday}) 밤 12시${minute}`;
  }
  const period = at.hour < 12 ? '오전' : '오후';
  const hour12 = at.hour % 12 === 0 ? 12 : at.hour % 12;
  return `${at.month}월 ${at.day}일(${at.weekday}) ${period} ${hour12}시${minute}`;
}

/** 예: "12월 1일(화)". 자정·0시대는 전날로 읽는다(formatRoundTime과 같은 규칙). 잘못된 값이면 null. */
export function formatRoundDay(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const at = kstParts(date);
  const day = at.hour === 0 ? kstParts(new Date(date.getTime() - DAY_MS)) : at;
  return `${day.month}월 ${day.day}일(${day.weekday})`;
}

/** 예: "11월 8일(일) 밤 12시까지" */
export function formatOrderCloseLabel(value: string): string {
  const time = formatRoundTime(value);
  return time ? `${time}까지` : '일정 확인 중';
}

/**
 * 회차 주문이 끝났는지. 판매 예정·판매 중이 아니면(마감·완료·취소) 끝났고, 판매 중이어도 주문 마감 시각이
 * 지났으면 끝난 것으로 본다(서버 상태가 바뀌기 전 다시 조회까지의 틈). 마감 시각이 잘못되면 상태로만 판단한다.
 */
export function isRoundOrderClosed(
  round: Pick<SaleRound, 'status' | 'schedule'>,
  nowMillis: number,
): boolean {
  if (round.status !== 'OPEN' && round.status !== 'SCHEDULED') return true;
  const closeAt = Date.parse(round.schedule.orderCloseAt);
  return Number.isFinite(closeAt) && closeAt <= nowMillis;
}

/**
 * 주문 마감 한 줄. 지난 마감에 "까지"를 붙이지 않는다.
 * 예: "주문 마감 11월 8일(일) 밤 12시까지", 마감 뒤 "주문 마감됨 · 11월 8일(일) 밤 12시".
 */
export function formatOrderCloseStatus(value: string, closed: boolean): string {
  if (!closed) return `주문 마감 ${formatOrderCloseLabel(value)}`;
  const time = formatRoundTime(value);
  return time ? `주문 마감됨 · ${time}` : '주문 마감됨';
}

/** 예: "11월 1일(일) 오전 10시 주문 시작" */
export function formatOrderOpenLabel(value: string): string {
  const time = formatRoundTime(value);
  return time ? `${time} 주문 시작` : '주문 시작 일정 확인 중';
}

/** 주문 시작 전 회차는 "이번 주"가 아니므로 제목을 나눈다. */
export function roundSectionTitle(status: SaleRoundStatus): string {
  return status === 'SCHEDULED' ? '판매 예정' : '이번 주 판매';
}
