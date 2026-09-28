import { describe, expect, it } from 'vitest';
import { EMPTY_FIELD, formatJoinedDate, formatPhone } from './_lib';

describe('formatJoinedDate', () => {
  it('ISO 문자열을 KST 날짜로 표기한다', () => {
    expect(formatJoinedDate('2026-09-01T03:00:00.000Z')).toBe('2026-09-01');
  });

  it('UTC 15시 이후(KST 자정 이후)는 다음 날짜로 표기한다 — 하루 밀림 회귀 가드', () => {
    expect(formatJoinedDate('2026-08-31T15:30:00.000Z')).toBe('2026-09-01');
  });

  it('Firestore raw 직렬화 { _seconds }도 KST 날짜로 표기한다', () => {
    const seconds = Date.parse('2026-08-31T15:30:00.000Z') / 1000;
    expect(formatJoinedDate({ _seconds: seconds, _nanoseconds: 0 })).toBe('2026-09-01');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['빈 문자열', ''],
    ['파싱 불가 문자열', 'not-a-date'],
    ['숫자가 아닌 _seconds', { _seconds: 'x' }],
    ['알 수 없는 객체', {}],
  ])('%s는 자리표시자를 반환한다', (_label, value) => {
    expect(formatJoinedDate(value)).toBe(EMPTY_FIELD);
  });
});

describe('formatPhone', () => {
  it('전화번호를 마스킹 없이 그대로 표시한다', () => {
    expect(formatPhone('010-1234-5678')).toBe('010-1234-5678');
  });

  it('앞뒤 공백을 제거한다', () => {
    expect(formatPhone('  01012345678 ')).toBe('01012345678');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['빈 문자열', ''],
    ['공백만', '   '],
  ])('%s는 자리표시자를 반환한다', (_label, value) => {
    expect(formatPhone(value)).toBe(EMPTY_FIELD);
  });
});
