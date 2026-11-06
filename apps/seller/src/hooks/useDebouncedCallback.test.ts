import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebounced } from './useDebouncedCallback';

describe('지연 호출(검색어 URL 반영)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('입력이 멈춘 뒤 delay가 지나야 한 번 실행한다', () => {
    const fn = vi.fn();
    const debounced = createDebounced(() => fn, 300);
    debounced('a');
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    expect(debounced.isPending()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
    expect(debounced.isPending()).toBe(false);
  });

  it('연달아 부르면 마지막 인자로 마지막 호출 뒤 delay에 한 번만 실행한다', () => {
    const fn = vi.fn();
    const debounced = createDebounced(() => fn, 300);
    debounced('a');
    vi.advanceTimersByTime(200);
    debounced('ab');
    vi.advanceTimersByTime(200);
    debounced('abc');
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('abc');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancel하면 실행하지 않고 남은 타이머도 없다(상태·정렬 즉시 반영, 언마운트 정리 경로)', () => {
    const fn = vi.fn();
    const debounced = createDebounced(() => fn, 300);
    debounced('a');
    debounced.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(debounced.isPending()).toBe(false);
  });

  it('flush는 걸린 호출을 지금 실행하고, 걸린 것이 없으면 아무것도 하지 않는다', () => {
    const fn = vi.fn();
    const debounced = createDebounced(() => fn, 300);
    debounced.flush();
    expect(fn).not.toHaveBeenCalled();
    debounced('a');
    debounced.flush();
    expect(fn).toHaveBeenCalledWith('a');
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('실행 때 그 시점의 최신 콜백을 부른다', () => {
    let current = vi.fn();
    const first = current;
    const debounced = createDebounced(() => current, 300);
    debounced('a');
    current = vi.fn();
    vi.advanceTimersByTime(300);
    expect(first).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledWith('a');
  });

  it('훅은 언마운트 때 걸린 호출을 지운다(Mantine flushOnUnmount 기본 false와 같다)', () => {
    const source = readFileSync(new URL('./useDebouncedCallback.ts', import.meta.url), 'utf8');
    expect(source).toContain('useEffect(() => debounced.cancel, [debounced]);');
  });
});
