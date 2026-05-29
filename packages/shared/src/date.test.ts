import { afterEach, describe, expect, it, vi } from 'vitest';
import { periodRange, toDateStrKST, toDateTimeStrKST, todayKST } from './date.js';

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

  it('시분 옵션이 있으면 KST 기준 HH:mm을 함께 반환한다', () => {
    expect(
      toDateStrKST(new Date('2026-05-23T15:30:00Z'), {
        hour: '2-digit',
        minute: '2-digit',
      }),
    ).toBe('2026-05-24 00:30');
  });

  it('시 옵션만 있으면 KST 기준 HH를 함께 반환한다', () => {
    expect(toDateStrKST(new Date('2026-05-24T03:00:00Z'), { hour: '2-digit' })).toBe(
      '2026-05-24 12',
    );
  });
});

describe('toDateTimeStrKST', () => {
  it('초대 내역용 MM-DD HH:mm 포맷을 KST 기준으로 반환한다', () => {
    expect(toDateTimeStrKST(new Date('2026-05-23T15:30:00Z'))).toBe('05-24 00:30');
  });
});

describe('periodRange', () => {
  it('이번 주 범위는 KST 월요일부터 오늘까지 반환한다', () => {
    const range = periodRange('thisWeek', new Date('2026-05-27T03:00:00Z'));
    expect(range).toEqual({ from: '2026-05-25', to: '2026-05-27', label: '이번 주' });
  });

  it('이번 달 범위는 KST 월초부터 오늘까지 반환한다', () => {
    const range = periodRange('thisMonth', new Date('2026-05-27T03:00:00Z'));
    expect(range).toEqual({ from: '2026-05-01', to: '2026-05-27', label: '이번 달' });
  });

  it('지난달 범위는 이전 달 전체를 반환한다', () => {
    const range = periodRange('lastMonth', new Date('2026-05-27T03:00:00Z'));
    expect(range).toEqual({ from: '2026-04-01', to: '2026-04-30', label: '지난달' });
  });

  it('연도 경계의 지난달 범위를 올바르게 반환한다', () => {
    const range = periodRange('lastMonth', new Date('2026-01-05T03:00:00Z'));
    expect(range).toEqual({ from: '2025-12-01', to: '2025-12-31', label: '지난달' });
  });
});
