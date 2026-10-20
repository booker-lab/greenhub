import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_KEEPALIVE_INTERVAL_MS,
  SESSION_PROBE_TIMEOUT_MS,
  shouldSyncSessionAccessToken,
  startSessionKeepAlive,
} from './session-keepalive';

describe('판매자 세션 유지', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('다른 쓸 수 있는 토큰일 때만 화면 세션을 갱신한다', () => {
    expect(shouldSyncSessionAccessToken('new', 'old')).toBe(true);
    expect(shouldSyncSessionAccessToken('same', 'same')).toBe(false);
    expect(shouldSyncSessionAccessToken('', 'old')).toBe(false);
    expect(shouldSyncSessionAccessToken(null, 'old')).toBe(false);
    expect(shouldSyncSessionAccessToken(undefined, undefined)).toBe(false);
  });

  it('2분마다 확인하고 새 토큰을 받았을 때만 갱신한다', async () => {
    let current = 'token-1';
    const probe = vi.fn(async () => current);
    const sync = vi.fn();
    const stop = startSessionKeepAlive({
      probeAccessToken: probe,
      currentAccessToken: () => current,
      syncSession: sync,
    });

    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_INTERVAL_MS - 1);
    expect(probe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(sync).not.toHaveBeenCalled();

    probe.mockResolvedValueOnce('token-2');
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_INTERVAL_MS);
    expect(sync).toHaveBeenCalledTimes(1);
    current = 'token-2';
    stop();
  });

  it('확인 실패·기한 초과는 무시하고 끝나지 않은 확인과 겹쳐 보내지 않는다', async () => {
    const probe = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValue('token-new');
    const sync = vi.fn();
    const stop = startSessionKeepAlive({
      probeAccessToken: probe,
      currentAccessToken: () => 'token-old',
      syncSession: sync,
    });

    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_INTERVAL_MS);
    expect(sync).not.toHaveBeenCalled();

    // 두 번째 확인은 끝나지 않는다. 다음 주기는 기한 전이라 겹쳐 보내지 않는다.
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_INTERVAL_MS);
    expect(probe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SESSION_PROBE_TIMEOUT_MS - 1);
    expect(probe).toHaveBeenCalledTimes(2);

    // 기한이 지나면 실패로 보고 다음 주기에 다시 확인한다.
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_INTERVAL_MS);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(sync).toHaveBeenCalledTimes(1);
    stop();
  });

  it('멈춘 뒤 도착한 확인 결과로는 갱신하지 않는다', async () => {
    let resolveProbe: (value: unknown) => void = () => undefined;
    const probe = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const sync = vi.fn();
    const stop = startSessionKeepAlive({
      probeAccessToken: probe,
      currentAccessToken: () => 'token-old',
      syncSession: sync,
    });

    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_INTERVAL_MS);
    stop();
    resolveProbe('token-new');
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).not.toHaveBeenCalled();
  });

  it('숨은 탭에서는 주기 확인을 건너뛰고 다시 보이면 즉시 1회 확인한다', async () => {
    let hidden = true;
    const listeners = new Set<() => void>();
    const emit = () => {
      for (const listener of listeners) listener();
    };
    const probe = vi.fn(async () => 'token-new');
    const sync = vi.fn();
    const stop = startSessionKeepAlive({
      probeAccessToken: probe,
      currentAccessToken: () => 'token-old',
      syncSession: sync,
      isHidden: () => hidden,
      subscribeVisibilityChange: (onChange) => {
        listeners.add(onChange);
        return () => listeners.delete(onChange);
      },
    });

    // 숨은 동안에는 여러 주기가 지나도 확인하지 않는다.
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_INTERVAL_MS * 3);
    expect(probe).not.toHaveBeenCalled();

    // 숨김으로 바뀌는 신호에는 확인하지 않는다.
    emit();
    await vi.advanceTimersByTimeAsync(0);
    expect(probe).not.toHaveBeenCalled();

    // 다시 보이면 주기를 기다리지 않고 즉시 1회 확인한다.
    hidden = false;
    emit();
    await vi.advanceTimersByTimeAsync(0);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(1);

    // 보이는 동안은 주기 확인을 이어 간다.
    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_INTERVAL_MS);
    expect(probe).toHaveBeenCalledTimes(2);

    // 멈추면 보이기 리스너를 해제한다.
    stop();
    expect(listeners.size).toBe(0);
  });

  it('보이게 된 순간 확인이 진행 중이면 겹쳐 보내지 않는다', async () => {
    let hidden = false;
    let onVisibilityChange: () => void = () => undefined;
    const probe = vi.fn(() => new Promise<unknown>(() => undefined));
    const stop = startSessionKeepAlive({
      probeAccessToken: probe,
      currentAccessToken: () => 'token-old',
      syncSession: vi.fn(),
      isHidden: () => hidden,
      subscribeVisibilityChange: (onChange) => {
        onVisibilityChange = onChange;
        return () => undefined;
      },
    });

    await vi.advanceTimersByTimeAsync(SESSION_KEEPALIVE_INTERVAL_MS);
    expect(probe).toHaveBeenCalledTimes(1);
    hidden = true;
    onVisibilityChange();
    hidden = false;
    onVisibilityChange();
    await vi.advanceTimersByTimeAsync(0);
    expect(probe).toHaveBeenCalledTimes(1);
    stop();
  });

  it('Providers가 인증 세션 동안 세션 유지를 켜고 refetchInterval은 쓰지 않는다', () => {
    const source = readFileSync(new URL('../app/providers.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(/<SessionKeepAlive \/>/);
    expect(source).toMatch(/startSessionKeepAlive\(/);
    expect(source).toMatch(/status !== 'authenticated'/);
    expect(source).not.toMatch(/refetchInterval=/);
    expect(source).toMatch(/isHidden: \(\) => document\.visibilityState === 'hidden'/);
    expect(source).toMatch(/addEventListener\('visibilitychange'/);
    expect(source).toMatch(/removeEventListener\('visibilitychange'/);
  });
});
