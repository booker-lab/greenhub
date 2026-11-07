import { describe, expect, it, vi } from 'vitest';
import { confirmSessionStore } from './onboarding-session';

const noWait = () => Promise.resolve();

describe('온보딩 가게 생성 뒤 세션 반영 확인', () => {
  it('서버 세션에 만든 가게의 storeId가 실리면 바로 true', async () => {
    const refresh = vi.fn().mockResolvedValue({ user: { storeId: 'store-1' } });
    await expect(confirmSessionStore({ refresh, storeId: 'store-1', wait: noWait })).resolves.toBe(
      true,
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('처음엔 비어 있다가 다시 받았을 때 실리면 true', async () => {
    const refresh = vi
      .fn()
      .mockResolvedValueOnce({ user: { storeId: null } })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ user: { storeId: 'store-1' } });
    const wait = vi.fn(noWait);
    await expect(confirmSessionStore({ refresh, storeId: 'store-1', wait })).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('정해진 횟수 안에 실리지 않거나 다른 가게면 false', async () => {
    const refresh = vi.fn().mockResolvedValue({ user: { storeId: 'other' } });
    await expect(
      confirmSessionStore({ refresh, storeId: 'store-1', attempts: 2, wait: noWait }),
    ).resolves.toBe(false);
    expect(refresh).toHaveBeenCalledTimes(2);

    const empty = vi.fn().mockResolvedValue(null);
    await expect(
      confirmSessionStore({ refresh: empty, storeId: 'store-1', wait: noWait }),
    ).resolves.toBe(false);
  });
});
