import { afterEach, describe, expect, it, vi } from 'vitest';
import { dateRangeKST, todayKST, toDateStrKST } from './date.js';

describe('todayKST', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('UTC 자정 직후(KST 오전 9시 이전)에도 KST 당일을 반환한다 — 하루 밀림 회귀 가드', () => {
    // UTC 2026-05-23T15:30:00Z = KST 2026-05-24 00:30 (UTC 그대로면 5/23로 밀림)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T15:30:00Z'));
    expect(todayKST()).toBe('2026-05-24');
  });

  it('UTC 정오(KST 정오) 시각도 KST 당일을 반환한다', () => {
    // UTC 2026-05-24T03:00:00Z = KST 2026-05-24 12:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T03:00:00Z'));
    expect(todayKST()).toBe('2026-05-24');
  });

  it('KST 자정 직전(UTC 14:59)에는 아직 전날을 반환한다 — 경계 하한', () => {
    // UTC 2026-05-23T14:59:00Z = KST 2026-05-23 23:59
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T14:59:00Z'));
    expect(todayKST()).toBe('2026-05-23');
  });
});

describe('toDateStrKST', () => {
  it('주어진 시각의 KST 기준 날짜를 반환한다', () => {
    // UTC 2026-05-23T15:30:00Z = KST 2026-05-24 00:30
    expect(toDateStrKST(new Date('2026-05-23T15:30:00Z'))).toBe('2026-05-24');
  });

  it('익일 경계 — 24시간 더한 시각은 다음 날짜를 반환한다', () => {
    const base = new Date('2026-05-24T03:00:00Z'); // KST 5/24 정오
    const next = new Date(base.getTime() + 86400000); // KST 5/25 정오
    expect(toDateStrKST(next)).toBe('2026-05-25');
  });

  it.each([
    ['KST 자정', '2026-08-23T15:00:00.000Z'],
    ['KST 08:59:59.999', '2026-08-23T23:59:59.999Z'],
    ['KST 09:00:00.000', '2026-08-24T00:00:00.000Z'],
    ['KST 23:59:59.999', '2026-08-24T14:59:59.999Z'],
  ])('%s 경계에서 KST business date를 유지한다', (_label, instant) => {
    expect(toDateStrKST(new Date(instant))).toBe('2026-08-24');
  });

  it('다음 날 KST 자정에서 business date가 전환된다', () => {
    expect(toDateStrKST(new Date('2026-08-24T15:00:00.000Z'))).toBe('2026-08-25');
  });
});

describe('dateRangeKST', () => {
  it('하루 범위는 KST 시작 inclusive와 다음 날 시작 exclusive를 반환한다', () => {
    const range = dateRangeKST('2026-08-24');

    expect(range.start.toISOString()).toBe('2026-08-23T15:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2026-08-24T15:00:00.000Z');
  });

  it('입력 날짜가 여러 날이어도 하루 단위 범위 의미를 유지한다', () => {
    const range = dateRangeKST('2026-08-26');

    expect(range.start.toISOString()).toBe('2026-08-25T15:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2026-08-26T15:00:00.000Z');
  });

  it('날짜 전용 형식이 아니거나 존재하지 않는 날짜를 거부한다', () => {
    expect(() => dateRangeKST('2026-8-24')).toThrow(RangeError);
    expect(() => dateRangeKST('2026-02-30')).toThrow(RangeError);
  });
});
