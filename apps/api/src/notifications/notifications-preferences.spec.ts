import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  NotificationsController,
  UpdateNotificationPreferencesDto,
} from './notifications.controller';
import { NotificationsService } from './notifications.service';

const validationOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

describe('알림 마케팅 동의 설정 계약', () => {
  describe('입력 검증', () => {
    it.each([
      [{ alimtalk: true }],
      [{ alimtalk: false }],
      [{ sms: true }],
      [{ sms: false }],
      [{ alimtalk: true, sms: false }],
    ])('허용 채널의 boolean 상태를 받는다: %p', async (input) => {
      const dto = plainToInstance(UpdateNotificationPreferencesDto, input);

      await expect(validate(dto, validationOptions)).resolves.toHaveLength(0);
    });

    it.each([
      [{}],
      [{ email: true }],
      [{ alimtalk: 'true' }],
      [{ sms: 1 }],
      [{ alimtalk: true, userId: 'other-user' }],
    ])('빈 입력, 알 수 없는 키, 잘못된 타입을 거부한다: %p', async (input) => {
      const dto = plainToInstance(UpdateNotificationPreferencesDto, input);

      expect(await validate(dto, validationOptions)).not.toHaveLength(0);
    });
  });

  it('인증된 현재 사용자 식별자와 검증된 설정만 서비스에 전달한다', async () => {
    const updatePreferences = jest.fn().mockResolvedValue({ alimtalk: false, sms: true });
    const controller = new NotificationsController({
      updatePreferences,
    } as unknown as NotificationsService);

    await expect(
      controller.updatePreferences({ sub: 'current-user', role: 'consumer' }, { alimtalk: false }),
    ).resolves.toEqual({ alimtalk: false, sms: true });
    expect(updatePreferences).toHaveBeenCalledWith('current-user', { alimtalk: false });
  });

  it('요청하지 않은 기존 채널 설정을 보존하고 저장된 상태를 반환한다', async () => {
    let user = {
      notificationPreferences: {
        alimtalk: true,
        sms: true,
      },
    };
    const update = jest.fn(async (data: Record<string, unknown>) => {
      user = { ...user, ...data } as typeof user;
    });
    const firestore = {
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({
          data: () => user,
        })),
        update,
      })),
      Timestamp: {
        now: jest.fn(() => new Date('2026-07-17T09:00:00.000+09:00')),
      },
    };
    const service = new (NotificationsService as any)(firestore, {}, {}, {});

    await expect(service.updatePreferences('current-user', { alimtalk: false })).resolves.toEqual({
      alimtalk: false,
      sms: true,
    });
    expect(firestore.doc).toHaveBeenCalledWith('users/current-user');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationPreferences: {
          alimtalk: false,
          sms: true,
        },
      }),
    );
  });
});
