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

  it('Providers가 인증 세션 동안 세션 유지를 켜고 refetchInterval은 쓰지 않는다', () => {
    const source = readFileSync(new URL('../app/providers.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(/<SessionKeepAlive \/>/);
    expect(source).toMatch(/startSessionKeepAlive\(/);
    expect(source).toMatch(/status !== 'authenticated'/);
    expect(source).not.toMatch(/refetchInterval=/);
  });
});
