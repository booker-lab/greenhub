/**
 * 날짜 유틸 — KST(UTC+9) 기준 SSOT (#CL-48)
 *
 * `new Date().toISOString()`은 UTC 기준이라 KST 00:00~08:59 시간대에
 * `slice(0,10)`/`split('T')[0]`로 추출한 날짜가 전날로 밀린다(자정 직후 캘린더 오작동).
 * 셀러 곳곳에 흩어진 인라인 +9h 보정을 이 함수로 통일한다.
 *
 * 주의: 이 파일은 shared 패키지 최초의 '런타임 함수'다(기존은 타입/상수 전용).
 * dual ESM/CJS 빌드(tsc + tsc -p tsconfig.cjs.json) 양쪽에 정상 산출되어야 한다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface ToDateStrKSTOptions {
  hour?: '2-digit';
  minute?: '2-digit';
}

export type PeriodRangeKey = 'thisWeek' | 'thisMonth' | 'lastMonth';

export interface PeriodRange {
  from: string;
  to: string;
  label: string;
}

/** KST 기준 오늘 날짜를 YYYY-MM-DD로 반환 (UTC 자정~오전9시 하루 밀림 방지) */
export function todayKST(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 주어진 시각의 KST 기준 날짜를 YYYY-MM-DD로 반환 */
export function toDateStrKST(date: Date, options: ToDateStrKSTOptions = {}): string {
  const iso = new Date(date.getTime() + KST_OFFSET_MS).toISOString();
  const datePart = iso.slice(0, 10);
  if (!options.hour && !options.minute) return datePart;

  const hour = options.hour ? iso.slice(11, 13) : undefined;
  const minute = options.minute ? iso.slice(14, 16) : undefined;
  const timePart = [hour, minute].filter(Boolean).join(':');
  return timePart ? `${datePart} ${timePart}` : datePart;
}

/** 주어진 시각의 KST 기준 날짜와 시각을 MM-DD HH:mm으로 반환 */
export function toDateTimeStrKST(date: Date): string {
  const iso = new Date(date.getTime() + KST_OFFSET_MS).toISOString();
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}

function dateStrUTC(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/** KST 기준 빠른 기간 범위. 이번 주는 월요일 시작, 종료일은 오늘이다. */
export function periodRange(key: PeriodRangeKey, now = new Date()): PeriodRange {
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  const year = kstNow.getUTCFullYear();
  const month = kstNow.getUTCMonth();
  const day = kstNow.getUTCDate();
  const today = dateStrUTC(year, month, day);

  if (key === 'thisWeek') {
    const mondayOffset = (kstNow.getUTCDay() + 6) % 7;
    const monday = new Date(Date.UTC(year, month, day - mondayOffset));
    return {
      from: monday.toISOString().slice(0, 10),
      to: today,
      label: '이번 주',
    };
  }

  if (key === 'thisMonth') {
    return {
      from: dateStrUTC(year, month, 1),
      to: today,
      label: '이번 달',
    };
  }

  return {
    from: dateStrUTC(year, month - 1, 1),
    to: dateStrUTC(year, month, 0),
    label: '지난달',
  };
}
