import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => {
  const apps: Array<{ options: Record<string, unknown> }> = [];
  const sessionPersistence = { type: 'SESSION' };
  return {
    apps,
    sessionPersistence,
    getApps: vi.fn(() => apps),
    getApp: vi.fn(() => apps[0]),
    initializeApp: vi.fn((options: Record<string, unknown>) => {
      const app = { options };
      apps.push(app);
      return app;
    }),
    getAuth: vi.fn(() => ({ kind: 'auth' })),
    connectAuthEmulator: vi.fn(),
    setPersistence: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('firebase/app', () => ({
  getApp: firebaseMocks.getApp,
  getApps: firebaseMocks.getApps,
  initializeApp: firebaseMocks.initializeApp,
}));

vi.mock('firebase/auth', () => ({
  browserSessionPersistence: firebaseMocks.sessionPersistence,
  connectAuthEmulator: firebaseMocks.connectAuthEmulator,
  getAuth: firebaseMocks.getAuth,
  setPersistence: firebaseMocks.setPersistence,
}));

vi.mock('firebase/firestore', () => ({
  connectFirestoreEmulator: vi.fn(),
  getFirestore: vi.fn(() => ({ kind: 'firestore' })),
  initializeFirestore: vi.fn(() => ({ kind: 'firestore' })),
  memoryLocalCache: vi.fn(() => ({ kind: 'memory-cache' })),
}));

vi.mock('firebase/storage', () => ({
  connectStorageEmulator: vi.fn(),
  getStorage: vi.fn(() => ({ kind: 'storage' })),
}));

const remoteEnvironment: Record<string, string> = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME: '',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'green-e4fe3',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'green-e4fe3.appspot.com',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'green-e4fe3.firebaseapp.com',
};

beforeEach(() => {
  firebaseMocks.apps.length = 0;
  vi.clearAllMocks();
  vi.resetModules();
  for (const [key, value] of Object.entries(remoteEnvironment)) vi.stubEnv(key, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Seller Firebase Auth 로그인 상태 보관', () => {
  it('브라우저에서는 탭 세션(sessionStorage) persistence를 한 번만 설정한다', async () => {
    vi.stubGlobal('window', {});
    const firebase = await import('./firebase');

    const auth = firebase.getFirebaseAuth();
    firebase.getFirebaseAuth();

    expect(firebaseMocks.setPersistence).toHaveBeenCalledTimes(1);
    expect(firebaseMocks.setPersistence).toHaveBeenCalledWith(
      auth,
      firebaseMocks.sessionPersistence,
    );
  });

  it('서버 렌더링(window 없음)에서는 persistence를 바꾸지 않는다', async () => {
    const firebase = await import('./firebase');
    firebase.getFirebaseAuth();
    expect(firebaseMocks.setPersistence).not.toHaveBeenCalled();
  });
});
