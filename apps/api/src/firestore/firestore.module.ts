import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import {
  getConfigValues,
  isLocalRuntime,
  RuntimeConfigurationError,
  resolveFirebaseAdminSettings,
} from '../config/runtime-config';
import { FirestoreService } from './firestore.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    {
      provide: 'FIREBASE_APP',
      inject: [ConfigService],
      useFactory: createFirebaseAdminApp,
    },
    FirestoreService,
    StorageService,
  ],
  exports: [FirestoreService, StorageService],
})
export class FirestoreModule implements OnApplicationShutdown {
  async onApplicationShutdown() {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  }
}

export function createFirebaseAdminApp(config: ConfigService): admin.app.App {
  const values = getConfigValues(config);
  const settings = resolveFirebaseAdminSettings(values);
  const existingApp = admin.apps[0];

  if (existingApp) {
    if (settings.projectId && existingApp.options.projectId !== settings.projectId) {
      throw new RuntimeConfigurationError(
        '이미 초기화된 Firebase project가 현재 구성과 일치하지 않습니다.',
      );
    }
    if (settings.storageBucket && existingApp.options.storageBucket !== settings.storageBucket) {
      throw new RuntimeConfigurationError(
        '이미 초기화된 Firebase storage bucket이 현재 구성과 일치하지 않습니다.',
      );
    }
    return existingApp;
  }

  const appOptions = {
    ...(isLocalRuntime(values)
      ? {}
      : {
          credential: (() => {
            try {
              return settings.serviceAccount
                ? admin.credential.cert(settings.serviceAccount)
                : admin.credential.applicationDefault();
            } catch {
              throw new RuntimeConfigurationError('Firebase 자격 증명을 초기화할 수 없습니다.');
            }
          })(),
        }),
    projectId: settings.projectId,
    storageBucket: settings.storageBucket,
  };

  try {
    return admin.initializeApp(appOptions);
  } catch {
    throw new RuntimeConfigurationError('Firebase Admin을 초기화할 수 없습니다.');
  }
}
