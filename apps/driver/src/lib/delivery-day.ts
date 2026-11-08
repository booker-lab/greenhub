// 기사 목록 행의 배송일 표시. 기사는 서울에서 일하므로 휴대폰·서버 시간대와 관계없이 서울 날짜로 판정한다.
// 서울은 일광 절약 시간이 없어 UTC+9 고정으로 계산한다(Intl 시간대 데이터에 기대지 않는다).

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

type SeoulDay = { year: number; month: number; day: number; weekday: string };

function toMillis(value: unknown): number | null {
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isNaN(millis) ? null : millis;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
}

function seoulDay(millis: number): SeoulDay {
  const shifted = new Date(millis + SEOUL_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: WEEKDAYS[shifted.getUTCDay()],
  };
}

/** 두 시각이 서울 날짜로 같은 날인지. 하나라도 읽을 수 없으면 false. */
export function isSameSeoulDay(a: unknown, b: unknown): boolean {
  const left = toMillis(a);
  const right = toMillis(b);
  if (left === null || right === null) return false;
  const x = seoulDay(left);
  const y = seoulDay(right);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

/**
 * 오늘(서울 날짜)이 아닌 배송일을 "11월 10일(화)"로 쓴다. 해가 다르면 "2027년 1월 3일(일)"처럼 연도를 붙인다.
 * 배송일이 없거나 읽을 수 없거나 오늘이면 null(행에 쓰지 않는다).
 */
export function formatDeliveryDayLabel(value: unknown, now: Date): string | null {
  const millis = toMillis(value);
  const nowMillis = toMillis(now);
  if (millis === null || nowMillis === null) return null;
  if (isSameSeoulDay(millis, nowMillis)) return null;
  const target = seoulDay(millis);
  const label = `${target.month}월 ${target.day}일(${target.weekday})`;
  return target.year === seoulDay(nowMillis).year ? label : `${target.year}년 ${label}`;
}
