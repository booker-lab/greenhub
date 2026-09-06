import { MODULE_METADATA } from '@nestjs/common/constants';

const applicationDefault = jest.fn(() => 'credential');
const cert = jest.fn((serviceAccount) => ({ kind: 'cert', serviceAccount }));
const initializeApp = jest.fn((options) => options);

jest.mock('firebase-admin', () => ({
  apps: [],
  credential: { applicationDefault, cert },
  initializeApp,
}));

import { FirestoreModule } from './firestore.module';
import { FirestoreService } from './firestore.service';
import { StorageService } from './storage.service';

function metadata<T>(target: object, key: string): T[] {
  return Reflect.getMetadata(key, target) ?? [];
}

describe('Firestore 모듈 계약', () => {
  it('FirestoreService와 StorageService를 provider로 등록하고 내보낸다', () => {
    const providers = metadata(FirestoreModule, MODULE_METADATA.PROVIDERS);
    const exports = metadata(FirestoreModule, MODULE_METADATA.EXPORTS);

    expect(providers).toContain(FirestoreService);
    expect(providers).toContain(StorageService);
    expect(exports).toContain(FirestoreService);
    expect(exports).toContain(StorageService);
  });

  it('StorageService가 재사용할 기존 FIREBASE_APP provider에 기본 bucket을 설정한다', async () => {
    const firebaseProvider = metadata<Record<string, unknown>>(
      FirestoreModule,
      MODULE_METADATA.PROVIDERS,
    ).find((provider) => provider.provide === 'FIREBASE_APP') as {
      useFactory: (config: { get: (key: string) => string | undefined }) => Promise<unknown>;
    };

    const result = await firebaseProvider.useFactory({
      get: (key) =>
        ({
          FIREBASE_PROJECT_ID: 'green-test',
          FIREBASE_STORAGE_BUCKET: 'green-test.firebasestorage.app',
        })[key],
    });

    expect(initializeApp).toHaveBeenCalledWith({
      credential: 'credential',
      projectId: 'green-test',
      storageBucket: 'green-test.firebasestorage.app',
    });
    expect(result).toEqual(
      expect.objectContaining({ storageBucket: 'green-test.firebasestorage.app' }),
    );
  });

  it('서비스 계정 JSON을 정규화해 명시 project와 bucket으로 초기화한다', async () => {
    const firebaseProvider = metadata<Record<string, unknown>>(
      FirestoreModule,
      MODULE_METADATA.PROVIDERS,
    ).find((provider) => provider.provide === 'FIREBASE_APP') as {
      useFactory: (config: { get: (key: string) => string | undefined }) => Promise<unknown>;
    };
    const serviceAccount = JSON.stringify({
      type: 'service_account',
      project_id: 'green-test',
      client_email: 'firebase@example.test',
      private_key: 'private-key',
    });

    const result = await firebaseProvider.useFactory({
      get: (key) =>
        ({
          NODE_ENV: 'test',
          FIREBASE_PROJECT_ID: 'green-test',
          FIREBASE_STORAGE_BUCKET: 'green-test.firebasestorage.app',
          FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccount,
        })[key],
    });

    expect(cert).toHaveBeenCalledWith({
      projectId: 'green-test',
      clientEmail: 'firebase@example.test',
      privateKey: 'private-key',
    });
    expect(result).toEqual(
      expect.objectContaining({
        projectId: 'green-test',
        storageBucket: 'green-test.firebasestorage.app',
      }),
    );
  });

  it('서비스 계정 JSON 파싱 실패는 원문 없이 안전하게 거부한다', async () => {
    const firebaseProvider = metadata<Record<string, unknown>>(
      FirestoreModule,
      MODULE_METADATA.PROVIDERS,
    ).find((provider) => provider.provide === 'FIREBASE_APP') as {
      useFactory: (config: { get: (key: string) => string | undefined }) => Promise<unknown>;
    };

    let error: unknown;
    try {
      firebaseProvider.useFactory({
        get: (key) =>
          ({
            FIREBASE_PROJECT_ID: 'green-test',
            FIREBASE_STORAGE_BUCKET: 'green-test.firebasestorage.app',
            FIREBASE_SERVICE_ACCOUNT_JSON: '{malformed-private-key}',
          })[key],
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toHaveProperty(
      'message',
      'FIREBASE_SERVICE_ACCOUNT_JSON이 올바른 JSON이 아닙니다.',
    );
    expect(String(error)).not.toContain('malformed-private-key');
  });

  it('local runtime은 명시적 credential 없이 exact emulator binding으로 초기화한다', () => {
    applicationDefault.mockClear();
    initializeApp.mockClear();

    const firebaseProvider = metadata<Record<string, unknown>>(
      FirestoreModule,
      MODULE_METADATA.PROVIDERS,
    ).find((provider) => provider.provide === 'FIREBASE_APP') as {
      useFactory: (config: { get: (key: string) => string | undefined }) => Promise<unknown>;
    };

    const result = firebaseProvider.useFactory({
      get: (key) =>
        ({
          NODE_ENV: 'development',
          GREENHUB_LOCAL_RUNTIME: 'true',
          GREENHUB_SCHEDULES_ENABLED: 'false',
          FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
          FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
          FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
          FIREBASE_PROJECT_ID: 'greenhub-local',
          FIREBASE_STORAGE_BUCKET: 'greenhub-local.appspot.com',
          GOOGLE_APPLICATION_CREDENTIALS: '',
          FIREBASE_SERVICE_ACCOUNT_JSON: '',
          FIREBASE_SERVICE_ACCOUNT_PATH: '',
        })[key],
    });

    expect(applicationDefault).not.toHaveBeenCalled();
    expect(initializeApp).toHaveBeenCalledWith({
      projectId: 'greenhub-local',
      storageBucket: 'greenhub-local.appspot.com',
    });
    expect(result).toEqual(
      expect.objectContaining({
        projectId: 'greenhub-local',
        storageBucket: 'greenhub-local.appspot.com',
      }),
    );
  });

  it('설정 project와 서비스 계정 project가 다르면 초기화 전에 거부한다', async () => {
    const firebaseProvider = metadata<Record<string, unknown>>(
      FirestoreModule,
      MODULE_METADATA.PROVIDERS,
    ).find((provider) => provider.provide === 'FIREBASE_APP') as {
      useFactory: (config: { get: (key: string) => string | undefined }) => Promise<unknown>;
    };
    const serviceAccount = JSON.stringify({
      project_id: 'other-project',
      client_email: 'firebase@example.test',
      private_key: 'private-key',
    });

    expect(() =>
      firebaseProvider.useFactory({
        get: (key) =>
          ({
            FIREBASE_PROJECT_ID: 'green-test',
            FIREBASE_STORAGE_BUCKET: 'green-test.firebasestorage.app',
            FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccount,
          })[key],
      }),
    ).toThrow('FIREBASE_PROJECT_ID와 Firebase 자격 증명 project가 일치하지 않습니다.');
  });
});
