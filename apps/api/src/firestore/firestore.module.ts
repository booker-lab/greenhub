import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { FirestoreService } from './firestore.service';

@Global()
@Module({
  providers: [
    {
      provide: 'FIREBASE_APP',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        if (admin.apps.length > 0) return admin.apps[0]!;
        const credential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
          ? admin.credential.cert(
              JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
            )
          : admin.credential.applicationDefault();
        return admin.initializeApp({
          credential,
          projectId: config.get<string>('FIREBASE_PROJECT_ID'),
        });
      },
    },
    FirestoreService,
  ],
  exports: [FirestoreService],
})
export class FirestoreModule implements OnApplicationShutdown {
  async onApplicationShutdown() {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  }
}
