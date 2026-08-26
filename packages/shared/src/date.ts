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
const DAY_MS = 24 * 60 * 60 * 1000;

export interface KSTDateRange {
  start: Date;
  endExclusive: Date;
}

/** KST 기준 오늘 날짜를 YYYY-MM-DD로 반환 (UTC 자정~오전9시 하루 밀림 방지) */
export function todayKST(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 주어진 시각의 KST 기준 날짜를 YYYY-MM-DD로 반환 */
export function toDateStrKST(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** KST 달력 날짜의 시작 시각과 다음 날 시작 시각을 UTC instant로 반환 */
export function dateRangeKST(date: string): KSTDateRange {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new RangeError(`KST 달력 날짜는 YYYY-MM-DD 형식이어야 합니다: ${date}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMidnight = new Date(0);
  utcMidnight.setUTCFullYear(year, month - 1, day);
  utcMidnight.setUTCHours(0, 0, 0, 0);

  if (
    utcMidnight.getUTCFullYear() !== year ||
    utcMidnight.getUTCMonth() !== month - 1 ||
    utcMidnight.getUTCDate() !== day
  ) {
    throw new RangeError(`유효하지 않은 KST 달력 날짜입니다: ${date}`);
  }

  const start = new Date(utcMidnight.getTime() - KST_OFFSET_MS);
  return { start, endExclusive: new Date(start.getTime() + DAY_MS) };
}
