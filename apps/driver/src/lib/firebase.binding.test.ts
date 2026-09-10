import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockFirebaseApp = {
  options: Record<string, unknown>;
};

const firebaseMocks = vi.hoisted(() => {
  const apps: MockFirebaseApp[] = [];
  return {
    apps,
    getApps: vi.fn(() => apps),
    getApp: vi.fn(() => apps[0]),
    initializeApp: vi.fn((options: Record<string, unknown>) => {
      const app = { options };
      apps.push(app);
      return app;
    }),
    initializeFirestore: vi.fn(() => ({ kind: 'firestore' })),
    getFirestore: vi.fn(() => ({ kind: 'firestore' })),
    connectFirestoreEmulator: vi.fn(),
    getAuth: vi.fn(() => ({ kind: 'auth' })),
    connectAuthEmulator: vi.fn(),
    getStorage: vi.fn(() => ({ kind: 'storage' })),
    connectStorageEmulator: vi.fn(),
  };
});

vi.mock('firebase/app', () => ({
  getApp: firebaseMocks.getApp,
  getApps: firebaseMocks.getApps,
  initializeApp: firebaseMocks.initializeApp,
}));

vi.mock('firebase/auth', () => ({
  connectAuthEmulator: firebaseMocks.connectAuthEmulator,
  getAuth: firebaseMocks.getAuth,
}));

vi.mock('firebase/firestore', () => ({
  connectFirestoreEmulator: firebaseMocks.connectFirestoreEmulator,
  getFirestore: firebaseMocks.getFirestore,
  initializeFirestore: firebaseMocks.initializeFirestore,
  memoryLocalCache: vi.fn(() => ({ kind: 'memory-cache' })),
}));

vi.mock('firebase/storage', () => ({
  connectStorageEmulator: firebaseMocks.connectStorageEmulator,
  getStorage: firebaseMocks.getStorage,
}));

const ENVIRONMENT_KEYS = [
  'NODE_ENV',
  'NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME',
  'NEXT_PUBLIC_VERCEL_ENV',
  'NEXT_PUBLIC_RAILWAY_ENVIRONMENT_NAME',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST',
  'NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST',
  'NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST',
  'NEXT_PUBLIC_GOOGLE_APPLICATION_CREDENTIALS',
  'NEXT_PUBLIC_FIREBASE_SERVICE_ACCOUNT_JSON',
  'NEXT_PUBLIC_FIREBASE_SERVICE_ACCOUNT_PATH',
] as const;

const localEnvironment = {
  NODE_ENV: 'development',
  NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME: 'true',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'greenhub-local',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'greenhub-local.appspot.com',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'greenhub-local.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
};

const remoteEnvironment = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'green-e4fe3',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'green-e4fe3.appspot.com',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'green-e4fe3.firebaseapp.com',
};

function setEnvironment(values: Record<string, string>): void {
  for (const key of ENVIRONMENT_KEYS) {
    vi.stubEnv(key, values[key] ?? '');
  }
}

beforeEach(() => {
  firebaseMocks.apps.length = 0;
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Driver Firebase local binding (FE-PILOT-DRIVER-FIREBASE-BINDING-PROOF-01, driver-only)', () => {
  it('local 구성에서 세 emulator connector를 한 번만 구성한다', async () => {
    setEnvironment(localEnvironment);
    const firebase = await import('./firebase');

    firebase.getFirebaseAuth();
    firebase.getFirebaseAuth();
    firebase.getFirebaseStorage();
    firebase.getFirebaseStorage();

    expect(firebaseMocks.connectAuthEmulator).toHaveBeenCalledTimes(1);
    expect(firebaseMocks.connectAuthEmulator).toHaveBeenCalledWith(
      expect.anything(),
      'http://127.0.0.1:9099',
      { disableWarnings: true },
    );
    expect(firebaseMocks.connectFirestoreEmulator).toHaveBeenCalledTimes(1);
    expect(firebaseMocks.connectFirestoreEmulator).toHaveBeenCalledWith(
      expect.anything(),
      '127.0.0.1',
      8080,
    );
    expect(firebaseMocks.connectStorageEmulator).toHaveBeenCalledTimes(1);
    expect(firebaseMocks.connectStorageEmulator).toHaveBeenCalledWith(
      expect.anything(),
      '127.0.0.1',
      9199,
    );
    expect(firebaseMocks.getAuth).toHaveBeenCalledTimes(1);
    expect(firebaseMocks.getStorage).toHaveBeenCalledTimes(1);
    expect(firebaseMocks.initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'greenhub-local',
        storageBucket: 'greenhub-local.appspot.com',
      }),
    );
  });

  it('remote 구성에서 emulator connector를 호출하지 않는다', async () => {
    setEnvironment(remoteEnvironment);
    const firebase = await import('./firebase');

    firebase.getFirebaseAuth();
    firebase.getFirebaseStorage();

    expect(firebaseMocks.connectAuthEmulator).not.toHaveBeenCalled();
    expect(firebaseMocks.connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(firebaseMocks.connectStorageEmulator).not.toHaveBeenCalled();
  });

  it('local marker와 non-loopback host가 섞이면 fail-closed한다', async () => {
    setEnvironment({
      ...localEnvironment,
      NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST: '192.168.0.10:9199',
    });

    await expect(import('./firebase')).rejects.toThrow('emulator host');
    expect(firebaseMocks.connectAuthEmulator).not.toHaveBeenCalled();
    expect(firebaseMocks.connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(firebaseMocks.connectStorageEmulator).not.toHaveBeenCalled();
  });

  it('local marker와 production identity가 섞이면 fail-closed한다', async () => {
    setEnvironment({
      ...localEnvironment,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'green-e4fe3',
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'green-e4fe3.appspot.com',
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'green-e4fe3.firebaseapp.com',
    });

    await expect(import('./firebase')).rejects.toThrow('운영 Firebase identity');
    expect(firebaseMocks.connectAuthEmulator).not.toHaveBeenCalled();
    expect(firebaseMocks.connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(firebaseMocks.connectStorageEmulator).not.toHaveBeenCalled();
  });

  it('public service-account 경로를 거부한다', async () => {
    setEnvironment({
      ...localEnvironment,
      NEXT_PUBLIC_FIREBASE_SERVICE_ACCOUNT_PATH: 'local-service-account.json',
    });

    await expect(import('./firebase')).rejects.toThrow('service account credential');
    expect(firebaseMocks.connectAuthEmulator).not.toHaveBeenCalled();
    expect(firebaseMocks.connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(firebaseMocks.connectStorageEmulator).not.toHaveBeenCalled();
  });

  it('driver consumer export(db/firebaseAuth/storage/getter)를 유지한다', async () => {
    setEnvironment(localEnvironment);
    const firebase = await import('./firebase');

    expect(firebase.db).toBeDefined();
    expect(firebase.firebaseAuth).toBeDefined();
    expect(firebase.storage).toBeDefined();
    expect(typeof firebase.getFirebaseAuth).toBe('function');
    expect(typeof firebase.getFirebaseStorage).toBe('function');
    expect(firebase.getFirebaseAuth()).toBe(firebase.firebaseAuth);
    expect(firebase.getFirebaseStorage()).toBe(firebase.storage);
  });
});
