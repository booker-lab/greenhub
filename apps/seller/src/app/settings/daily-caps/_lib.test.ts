import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentMonthKST } from './_lib';

const originalTZ = process.env.TZ;

function monthIn(tz: string) {
  process.env.TZ = tz;
  return currentMonthKST();
}

describe('배송 한도 달력의 처음 달(KST)', () => {
  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTZ;
  });

  it('KST 매월 1일 00~09시에도 서버(UTC)와 브라우저(KST)가 같은 달을 고른다', () => {
    // 2026-11-01 00:30 KST = 2026-10-31 15:30 UTC. 서버 지역 시간 getMonth()는 10월(9)이다.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T15:30:00.000Z'));
    process.env.TZ = 'UTC';
    expect(new Date().getMonth()).toBe(9); // 예전 계산(서버 지역 시간)은 10월이었다.
    process.env.TZ = 'Asia/Seoul';
    expect(new Date().getMonth()).toBe(10); // 브라우저(KST)는 11월.
    expect(monthIn('UTC')).toEqual({ year: 2026, month: 10 });
    expect(monthIn('Asia/Seoul')).toEqual({ year: 2026, month: 10 });
  });

  it('KST 08:59에도 이번 달이고, 연말 경계도 KST 기준이다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T23:59:00.000Z')); // 2026-11-01 08:59 KST
    expect(monthIn('UTC')).toEqual({ year: 2026, month: 10 });
    vi.setSystemTime(new Date('2026-12-31T15:00:00.000Z')); // 2027-01-01 00:00 KST
    expect(monthIn('UTC')).toEqual({ year: 2027, month: 0 });
    expect(monthIn('Asia/Seoul')).toEqual({ year: 2027, month: 0 });
  });

  it('KST 말일 밤(UTC로는 같은 날)에는 그달이다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T14:59:00.000Z')); // 2026-10-31 23:59 KST
    expect(monthIn('UTC')).toEqual({ year: 2026, month: 9 });
    expect(monthIn('Asia/Seoul')).toEqual({ year: 2026, month: 9 });
  });
});
