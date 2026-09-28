import { describe, expect, it } from 'vitest';
import { toDateStr, toKSTISO } from './_lib';

// 오전/오후 표기는 ICU 버전에 따라 달라질 수 있어 월·일과 시:분 숫자만 검증한다.
// 포매터가 timeZone을 고정하므로 실행 환경 시간대와 무관하다.
describe('toDateStr (셀러 정산일시 KST 표기)', () => {
  it('UTC 15:00 직전은 KST 같은 날 23:59로 표시한다', () => {
    const text = toDateStr('2026-09-27T14:59:00.000Z');
    expect(text).toContain('9월 27일');
    expect(text).toContain('11:59');
  });

  it('UTC 15:00 직후는 KST 다음 날 0시로 표시한다', () => {
    const text = toDateStr('2026-09-27T15:00:00.000Z');
    expect(text).toContain('9월 28일');
    expect(text).not.toContain('27일');
  });

  it('초 단위 숫자와 `{ _seconds }`도 같은 KST 기준으로 표시한다', () => {
    const seconds = Date.parse('2026-09-27T15:00:00.000Z') / 1000;
    const expected = toDateStr('2026-09-27T15:00:00.000Z');
    expect(toDateStr(seconds)).toBe(expected);
    expect(toDateStr({ _seconds: seconds })).toBe(expected);
  });

  it('파싱할 수 없는 값은 "-"로 표시한다', () => {
    expect(toDateStr('not-a-date')).toBe('-');
    expect(toDateStr(null)).toBe('-');
  });
});

describe('toKSTISO (CSV 정산일시)', () => {
  it('KST 오프셋을 붙여 KST 날짜로 기록한다', () => {
    expect(toKSTISO('2026-09-27T15:00:00.000Z')).toBe('2026-09-28T00:00:00+09:00');
    expect(toKSTISO('2026-12-31T15:30:00.000Z')).toBe('2027-01-01T00:30:00+09:00');
  });

  it('같은 순간을 가리킨다(Date로 다시 읽으면 원래 시각)', () => {
    const iso = '2026-09-27T14:59:00.000Z';
    expect(new Date(toKSTISO(iso)).toISOString()).toBe(iso);
  });

  it('초 단위 숫자·`{ _seconds }`를 처리하고 파싱 불가는 빈 문자열', () => {
    const seconds = Date.parse('2026-09-27T15:00:00.000Z') / 1000;
    expect(toKSTISO(seconds)).toBe('2026-09-28T00:00:00+09:00');
    expect(toKSTISO({ _seconds: seconds })).toBe('2026-09-28T00:00:00+09:00');
    expect(toKSTISO('bad')).toBe('');
  });
});
