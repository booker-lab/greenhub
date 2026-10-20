import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResettableTimer } from './useResettableTimeout';

describe('되돌림 타이머', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('정해진 시간 뒤 한 번 실행한다', () => {
    const timer = createResettableTimer();
    const fn = vi.fn();
    timer.schedule(fn, 2000);
    vi.advanceTimersByTime(1999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('새로 걸면 이전 타이머를 해제해 마지막 것만 실행한다', () => {
    const timer = createResettableTimer();
    const first = vi.fn();
    const second = vi.fn();
    timer.schedule(first, 2000);
    vi.advanceTimersByTime(1500);
    timer.schedule(second, 2000);
    vi.advanceTimersByTime(1500);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('해제하면 실행하지 않고 남은 타이머도 없다(언마운트 정리 경로)', () => {
    const timer = createResettableTimer();
    const fn = vi.fn();
    timer.schedule(fn, 2000);
    timer.clear();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    // 걸린 것이 없을 때 해제해도 문제없다.
    timer.clear();
  });

  it('"저장됨" 표시 화면들이 맨 setTimeout 대신 정리되는 타이머를 쓴다', () => {
    const files = [
      '../app/admin/banner/_client.tsx',
      '../app/settings/delivery/page.tsx',
      '../app/products/_components/useProductForm.ts',
      '../app/hubs/[id]/pickup/page.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).toContain('useResettableTimeout()');
      expect(source, file).not.toMatch(/(^|[^.\w])setTimeout\(/m);
    }
  });
});
