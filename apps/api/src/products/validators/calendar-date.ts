import { BadRequestException, type PipeTransform } from '@nestjs/common';

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` 형식이면서 실제 달력에 있는 날짜인지 확인한다(예: 2026-02-30 거부). */
export function isCalendarDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/**
 * 경로·쿼리의 날짜 값을 `YYYY-MM-DD` 달력 날짜로 제한한다.
 * optional이면 값이 없을 때(undefined) 그대로 통과시킨다. 인스턴스(`new CalendarDatePipe()`)로 쓴다.
 */
export class CalendarDatePipe implements PipeTransform<unknown, string | undefined> {
  constructor(private readonly options: { optional?: boolean } = {}) {}

  transform(value: unknown): string | undefined {
    if (value === undefined && this.options.optional) return undefined;
    if (!isCalendarDateString(value)) {
      throw new BadRequestException('날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다.');
    }
    return value;
  }
}
