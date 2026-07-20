import { MODULE_METADATA } from '@nestjs/common/constants';

const applicationDefault = jest.fn(() => 'credential');
const initializeApp = jest.fn((options) => options);

jest.mock('firebase-admin', () => ({
  apps: [],
  credential: { applicationDefault },
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
    ).find((provider) => provider['provide'] === 'FIREBASE_APP') as {
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
});
