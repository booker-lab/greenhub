import { BadRequestException } from '@nestjs/common';
import { CalendarDatePipe, isCalendarDateString } from './calendar-date';

describe('YYYY-MM-DD 달력 날짜', () => {
  it.each(['2026-01-01', '2026-12-31', '2028-02-29', '2026-02-28'])('%s를 허용한다', (value) => {
    expect(isCalendarDateString(value)).toBe(true);
  });

  it.each([
    '2026-02-29',
    '2026-02-30',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-1-01',
    '2026/01/01',
    '2026-01-01/x',
    '2026-01-01T00:00:00Z',
    '',
    ' 2026-01-01',
  ])('%s를 거부한다', (value) => {
    expect(isCalendarDateString(value)).toBe(false);
  });

  it.each([
    [undefined],
    [null],
    [20260101],
    [['2026-01-01']],
  ])('문자열이 아닌 %p를 거부한다', (value) => {
    expect(isCalendarDateString(value)).toBe(false);
  });
});

describe('CalendarDatePipe', () => {
  it('유효한 날짜를 그대로 돌려준다', () => {
    expect(new CalendarDatePipe().transform('2026-08-25')).toBe('2026-08-25');
  });

  it('필수 날짜가 없거나 잘못되면 400을 낸다', () => {
    expect(() => new CalendarDatePipe().transform(undefined)).toThrow(BadRequestException);
    expect(() => new CalendarDatePipe().transform('2026-02-30')).toThrow(BadRequestException);
  });

  it('optional이면 값이 없을 때만 통과시킨다', () => {
    const pipe = new CalendarDatePipe({ optional: true });
    expect(pipe.transform(undefined)).toBeUndefined();
    expect(() => pipe.transform(['2026-01-01', '2026-01-02'])).toThrow(BadRequestException);
    expect(() => pipe.transform('')).toThrow(BadRequestException);
  });
});
