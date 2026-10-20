import { describe, expect, it, vi } from 'vitest';

// vitest에는 '@/' 별칭 설정이 없어 Firebase·세션 의존은 같은 모양으로 대신한다.
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'loading' }) }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(),
  signInWithCustomToken: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/lib/firebase', () => ({ getFirebaseAuth: () => ({}) }));
vi.mock('@/lib/api-base-url', () => ({ getApiBaseUrl: () => 'http://api.test' }));

import { syncFirebaseSignIn } from './useFirebaseAuth';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('Firebase 로그인 동기화 취소', () => {
  it('취소되지 않으면 받은 토큰으로 로그인한다', async () => {
    const signIn = vi.fn(async () => undefined);
    const result = await syncFirebaseSignIn({
      fetchCustomToken: async () => 'custom-token',
      signIn,
      isCancelled: () => false,
    });
    expect(result).toBe('signed-in');
    expect(signIn).toHaveBeenCalledWith('custom-token');
  });

  it('토큰을 받는 도중 취소되면 로그인하지 않는다', async () => {
    let cancelled = false;
    const token = deferred<string>();
    const signIn = vi.fn(async () => undefined);
    const onLateSignIn = vi.fn(async () => undefined);
    const pending = syncFirebaseSignIn({
      fetchCustomToken: () => token.promise,
      signIn,
      isCancelled: () => cancelled,
      onLateSignIn,
    });
    cancelled = true;
    token.resolve('custom-token');
    expect(await pending).toBe('cancelled');
    expect(signIn).not.toHaveBeenCalled();
    expect(onLateSignIn).not.toHaveBeenCalled();
  });

  it('로그인 도중 취소되면 끝난 뒤 되돌릴 기회를 준다', async () => {
    let cancelled = false;
    const signedIn = deferred<void>();
    const signIn = vi.fn(() => signedIn.promise);
    const onLateSignIn = vi.fn(async () => undefined);
    const pending = syncFirebaseSignIn({
      fetchCustomToken: async () => 'custom-token',
      signIn,
      isCancelled: () => cancelled,
      onLateSignIn,
    });
    await vi.waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    cancelled = true;
    signedIn.resolve();
    expect(await pending).toBe('cancelled');
    expect(onLateSignIn).toHaveBeenCalledTimes(1);
  });

  it('토큰 요청 실패는 호출자에게 그대로 전한다', async () => {
    await expect(
      syncFirebaseSignIn({
        fetchCustomToken: async () => {
          throw new Error('firebase-token fetch failed: 500');
        },
        signIn: vi.fn(),
        isCancelled: () => false,
      }),
    ).rejects.toThrow('firebase-token fetch failed: 500');
  });
});
