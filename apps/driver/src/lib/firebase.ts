import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';

const LOCAL_FIREBASE_PROJECT_ID = 'greenhub-local';
const LOCAL_FIREBASE_STORAGE_BUCKET = 'greenhub-local.appspot.com';
const LOCAL_FIRESTORE_EMULATOR_HOST = '127.0.0.1';
const LOCAL_FIRESTORE_EMULATOR_PORT = 8080;
const LOCAL_FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1';
const LOCAL_FIREBASE_AUTH_EMULATOR_PORT = 9099;
const LOCAL_FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1';
const LOCAL_FIREBASE_STORAGE_EMULATOR_PORT = 9199;

const LOCAL_FIRESTORE_EMULATOR_ENDPOINT =
  `${LOCAL_FIRESTORE_EMULATOR_HOST}:${LOCAL_FIRESTORE_EMULATOR_PORT}`;
const LOCAL_FIREBASE_AUTH_EMULATOR_ENDPOINT =
  `${LOCAL_FIREBASE_AUTH_EMULATOR_HOST}:${LOCAL_FIREBASE_AUTH_EMULATOR_PORT}`;
const LOCAL_FIREBASE_STORAGE_EMULATOR_ENDPOINT =
  `${LOCAL_FIREBASE_STORAGE_EMULATOR_HOST}:${LOCAL_FIREBASE_STORAGE_EMULATOR_PORT}`;
const PRODUCTION_FIREBASE_PROJECTS = new Set(['green-e4fe3']);
const PRODUCTION_FIREBASE_STORAGE_BUCKETS = new Set([
  'green-e4fe3.appspot.com',
  'green-e4fe3.firebasestorage.app',
]);
const PRODUCTION_FIREBASE_AUTH_DOMAINS = new Set(['green-e4fe3.firebaseapp.com']);
const FIREBASE_EMULATOR_HOST_KEYS = [
  'NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST',
  'NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST',
  'NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST',
] as const;
const FIREBASE_PUBLIC_CREDENTIAL_KEYS = [
  'NEXT_PUBLIC_GOOGLE_APPLICATION_CREDENTIALS',
  'NEXT_PUBLIC_FIREBASE_SERVICE_ACCOUNT_JSON',
  'NEXT_PUBLIC_FIREBASE_SERVICE_ACCOUNT_PATH',
] as const;
const REGISTRY_KEY = Symbol.for('greenhub.firebase.service-registry');

type BrowserRuntimeValues = Record<string, unknown>;

type FirebaseServiceRegistry = {
  auth?: Auth;
  firestore?: Firestore;
  storage?: FirebaseStorage;
  localRuntime?: boolean;
  emulators?: {
    auth?: boolean;
    firestore?: boolean;
    storage?: boolean;
  };
};

export class FirebaseRuntimeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirebaseRuntimeConfigurationError';
  }
}

function readString(values: BrowserRuntimeValues, key: string): string {
  const value = values[key];
  return typeof value === 'string' ? value.trim() : '';
}

function browserRuntimeValues(): BrowserRuntimeValues {
  return {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME: process.env.NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    NEXT_PUBLIC_RAILWAY_ENVIRONMENT_NAME: process.env.NEXT_PUBLIC_RAILWAY_ENVIRONMENT_NAME,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
    NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST,
    NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST:
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST,
    NEXT_PUBLIC_GOOGLE_APPLICATION_CREDENTIALS:
      process.env.NEXT_PUBLIC_GOOGLE_APPLICATION_CREDENTIALS,
    NEXT_PUBLIC_FIREBASE_SERVICE_ACCOUNT_JSON:
      process.env.NEXT_PUBLIC_FIREBASE_SERVICE_ACCOUNT_JSON,
    NEXT_PUBLIC_FIREBASE_SERVICE_ACCOUNT_PATH:
      process.env.NEXT_PUBLIC_FIREBASE_SERVICE_ACCOUNT_PATH,
  };
}

function hasProductionMarker(values: BrowserRuntimeValues): boolean {
  return ['NODE_ENV', 'NEXT_PUBLIC_VERCEL_ENV', 'NEXT_PUBLIC_RAILWAY_ENVIRONMENT_NAME'].some(
    (key) => readString(values, key) === 'production',
  );
}

function hasProductionIdentity(values: BrowserRuntimeValues): boolean {
  return (
    PRODUCTION_FIREBASE_PROJECTS.has(readString(values, 'NEXT_PUBLIC_FIREBASE_PROJECT_ID')) ||
    PRODUCTION_FIREBASE_STORAGE_BUCKETS.has(
      readString(values, 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'),
    ) ||
    PRODUCTION_FIREBASE_AUTH_DOMAINS.has(readString(values, 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'))
  );
}

function hasConfiguredEmulatorHost(values: BrowserRuntimeValues): boolean {
  return FIREBASE_EMULATOR_HOST_KEYS.some((key) => Boolean(readString(values, key)));
}

function hasPublicCredential(values: BrowserRuntimeValues): boolean {
  return FIREBASE_PUBLIC_CREDENTIAL_KEYS.some((key) => Boolean(readString(values, key)));
}

function hasOnlyExpectedEmulatorHosts(values: BrowserRuntimeValues): boolean {
  return (
    ['', LOCAL_FIREBASE_AUTH_EMULATOR_ENDPOINT].includes(
      readString(values, 'NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST'),
    ) &&
    ['', LOCAL_FIRESTORE_EMULATOR_ENDPOINT].includes(
      readString(values, 'NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST'),
    ) &&
    ['', LOCAL_FIREBASE_STORAGE_EMULATOR_ENDPOINT].includes(
      readString(values, 'NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST'),
    )
  );
}

export function isLocalFirebaseRuntime(values: BrowserRuntimeValues): boolean {
  return (
    readString(values, 'NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME') === 'true' &&
    readString(values, 'NODE_ENV') === 'development' &&
    !hasProductionMarker(values) &&
    !hasProductionIdentity(values) &&
    readString(values, 'NEXT_PUBLIC_FIREBASE_PROJECT_ID') === LOCAL_FIREBASE_PROJECT_ID &&
    readString(values, 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET') ===
      LOCAL_FIREBASE_STORAGE_BUCKET &&
    hasOnlyExpectedEmulatorHosts(values) &&
    !hasPublicCredential(values)
  );
}

export function assertFirebaseRuntimeConfiguration(values: BrowserRuntimeValues): boolean {
  if (hasPublicCredential(values)) {
    throw new FirebaseRuntimeConfigurationError(
      '브라우저 Firebase 설정에는 service account credential을 둘 수 없습니다.',
    );
  }

  const localMarker = readString(values, 'NEXT_PUBLIC_GREENHUB_LOCAL_RUNTIME') === 'true';
  if (!localMarker) {
    if (hasConfiguredEmulatorHost(values)) {
      throw new FirebaseRuntimeConfigurationError(
        'non-local 브라우저 설정에는 Firebase emulator host를 둘 수 없습니다.',
      );
    }
    return false;
  }

  if (readString(values, 'NODE_ENV') !== 'development' || hasProductionMarker(values)) {
    throw new FirebaseRuntimeConfigurationError(
      '운영 환경에서는 local Firebase runtime을 사용할 수 없습니다.',
    );
  }
  if (hasProductionIdentity(values)) {
    throw new FirebaseRuntimeConfigurationError(
      'local Firebase runtime에는 운영 Firebase identity를 사용할 수 없습니다.',
    );
  }
  if (readString(values, 'NEXT_PUBLIC_FIREBASE_PROJECT_ID') !== LOCAL_FIREBASE_PROJECT_ID) {
    throw new FirebaseRuntimeConfigurationError(
      'local Firebase runtime은 greenhub-local project만 사용할 수 있습니다.',
    );
  }
  if (readString(values, 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET') !== LOCAL_FIREBASE_STORAGE_BUCKET) {
    throw new FirebaseRuntimeConfigurationError(
      'local Firebase runtime은 greenhub-local.appspot.com bucket만 사용할 수 있습니다.',
    );
  }
  if (!hasOnlyExpectedEmulatorHosts(values)) {
    throw new FirebaseRuntimeConfigurationError(
      'local Firebase runtime의 emulator host가 동결 계약과 일치하지 않습니다.',
    );
  }

  return true;
}

const localRuntime = assertFirebaseRuntimeConfiguration(browserRuntimeValues());

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function getServiceRegistry(app: FirebaseApp): FirebaseServiceRegistry {
  const appWithRegistry = app as FirebaseApp &
    Record<symbol, FirebaseServiceRegistry | undefined>;
  const registry = appWithRegistry[REGISTRY_KEY] ?? {};
  appWithRegistry[REGISTRY_KEY] = registry;
  if (registry.localRuntime !== undefined && registry.localRuntime !== localRuntime) {
    throw new FirebaseRuntimeConfigurationError(
      'Firebase app의 local/remote runtime binding이 변경되었습니다.',
    );
  }
  registry.localRuntime = localRuntime;
  return registry;
}

function getFirebaseApp(): FirebaseApp {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  if (localRuntime && app.options.projectId !== LOCAL_FIREBASE_PROJECT_ID) {
    throw new FirebaseRuntimeConfigurationError(
      '초기화된 Firebase app이 local project와 일치하지 않습니다.',
    );
  }
  if (localRuntime && app.options.storageBucket !== LOCAL_FIREBASE_STORAGE_BUCKET) {
    throw new FirebaseRuntimeConfigurationError(
      '초기화된 Firebase app이 local storage bucket과 일치하지 않습니다.',
    );
  }
  return app;
}

const app = getFirebaseApp();

function isAlreadyInitializedError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'failed-precondition' || code === 'firestore/failed-precondition';
}

function configureFirestoreEmulator(
  firestore: Firestore,
  registry: FirebaseServiceRegistry,
): void {
  if (!localRuntime) return;
  const emulators = registry.emulators ?? {};
  registry.emulators = emulators;
  if (emulators.firestore) return;
  connectFirestoreEmulator(
    firestore,
    LOCAL_FIRESTORE_EMULATOR_HOST,
    LOCAL_FIRESTORE_EMULATOR_PORT,
  );
  emulators.firestore = true;
}

function getFirestoreInstance(): Firestore {
  const registry = getServiceRegistry(app);
  if (registry.firestore) return registry.firestore;

  let firestore: Firestore;
  try {
    firestore = initializeFirestore(app, { localCache: memoryLocalCache() });
  } catch (error) {
    if (!isAlreadyInitializedError(error)) throw error;
    firestore = getFirestore(app);
  }
  registry.firestore = firestore;
  configureFirestoreEmulator(firestore, registry);
  return firestore;
}

export function getFirebaseAuth(): Auth {
  const registry = getServiceRegistry(app);
  if (registry.auth) return registry.auth;
  const auth = getAuth(app);
  if (localRuntime) {
    const emulators = registry.emulators ?? {};
    registry.emulators = emulators;
    if (!emulators.auth) {
      connectAuthEmulator(auth, `http://${LOCAL_FIREBASE_AUTH_EMULATOR_ENDPOINT}`, {
        disableWarnings: true,
      });
      emulators.auth = true;
    }
  }
  registry.auth = auth;
  return auth;
}

export function getFirebaseStorage(): FirebaseStorage {
  const registry = getServiceRegistry(app);
  if (registry.storage) return registry.storage;
  const storage = getStorage(app);
  if (localRuntime) {
    const emulators = registry.emulators ?? {};
    registry.emulators = emulators;
    if (!emulators.storage) {
      connectStorageEmulator(
        storage,
        LOCAL_FIREBASE_STORAGE_EMULATOR_HOST,
        LOCAL_FIREBASE_STORAGE_EMULATOR_PORT,
      );
      emulators.storage = true;
    }
  }
  registry.storage = storage;
  return storage;
}

export const db = getFirestoreInstance();

export const firebaseAuth = getFirebaseAuth();
export const storage = getFirebaseStorage();

if (localRuntime && typeof window !== 'undefined') {
  getFirebaseAuth();
  getFirebaseStorage();
}
