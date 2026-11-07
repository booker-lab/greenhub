import { ValidationPipe } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { UpdateNotificationPreferencesDto } from './notifications.controller';
import { NotificationsService } from './notifications.service';

// 전역 ValidationPipe를 거친 알림 설정 본문에는 보내지 않은 채널이 undefined 값으로 남아요.
// 그 값이 Firestore에 닿으면 500이 나던 회귀를 막아요. 쓰기 값은 실제 Firestore SDK의
// 동기 검증(WriteBatch.update)을 거쳐요. 네트워크는 쓰지 않아요.

type Data = Record<string, unknown>;

describe('알림 설정 저장 Firestore 값 검증', () => {
  let app: admin.app.App;
  let db: admin.firestore.Firestore;

  beforeAll(() => {
    app = admin.initializeApp(
      { projectId: 'demo-notification-preferences-write-spec' },
      `notification-preferences-write-${Date.now()}`,
    );
    db = app.firestore();
  });

  afterAll(async () => {
    await app.delete();
  });

  it('채널 하나만 보내도 저장되고 다른 채널 설정은 그대로 남아요', async () => {
    const records = new Map<string, Data>([
      ['users/user-1', { id: 'user-1', notificationPreferences: { alimtalk: true, sms: true } }],
    ]);
    const firestore = {
      doc: (path: string) => ({
        get: async () => ({ exists: records.has(path), data: () => records.get(path) }),
        update: async (data: Data) => {
          db.batch().update(db.doc(path), data);
          records.set(path, { ...(records.get(path) ?? {}), ...data });
        },
      }),
      Timestamp: admin.firestore.Timestamp,
    };
    const service = new (NotificationsService as any)(
      firestore,
      {},
      {},
      {},
    ) as NotificationsService;
    const pipe = new ValidationPipe(sanitizedValidationPipeOptions());
    const dto = (await pipe.transform(
      { alimtalk: false },
      { type: 'body', metatype: UpdateNotificationPreferencesDto },
    )) as UpdateNotificationPreferencesDto;
    // 전제: 보내지 않은 sms가 undefined 값의 자체 속성으로 남아 있어요.
    expect(Object.hasOwn(dto, 'sms')).toBe(true);

    await expect(service.updatePreferences('user-1', dto)).resolves.toEqual({
      alimtalk: false,
      sms: true,
    });
    expect(records.get('users/user-1')!['notificationPreferences']).toEqual({
      alimtalk: false,
      sms: true,
    });
  });
});
