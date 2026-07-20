import { ConfigService } from '@nestjs/config';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AligoClient } from './aligo.client';
import { E2EAligoClient } from './e2e-aligo.client';
import { createAligoProvider, NotificationsModule } from './notifications.module';

function config(values: Record<string, string>) {
  return new ConfigService(values);
}

describe('알림 provider 선택 계약', () => {
  it('일반 실행은 기존 AligoClient를 유지한다', () => {
    const provider = createAligoProvider(
      config({
        NODE_ENV: 'development',
        ROUND_DIRECT_E2E_ENABLED: 'false',
        ROUND_DIRECT_E2E_PROVIDER_MODE: 'live',
      }),
    );
    expect(provider).toBeInstanceOf(AligoClient);
    expect(provider).not.toBeInstanceOf(E2EAligoClient);
  });

  it('검증된 비운영 stub mode에서만 E2EAligoClient를 선택한다', () => {
    const provider = createAligoProvider(
      config({
        NODE_ENV: 'test',
        RAILWAY_ENVIRONMENT_NAME: 'staging',
        ROUND_DIRECT_E2E_ENABLED: 'true',
        ROUND_DIRECT_E2E_ENV: 'preview',
        ROUND_DIRECT_E2E_PROVIDER_MODE: 'stub',
        ROUND_DIRECT_E2E_SHARED_SECRET: '비공개',
        ROUND_DIRECT_E2E_RUN_ID: 'task-6-7-run-001',
        FIREBASE_PROJECT_ID: 'green-staging-74557',
        ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS: 'green-staging-74557',
      }),
    );
    expect(provider).toBeInstanceOf(E2EAligoClient);
  });

  it('NotificationsModule은 AligoClient token을 factory provider로 한 번만 등록한다', () => {
    const providers = (Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      NotificationsModule,
    ) ?? []) as Array<Record<string, unknown>>;
    const matches = providers.filter((provider) => provider['provide'] === AligoClient);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      provide: AligoClient,
      inject: [ConfigService],
      useFactory: createAligoProvider,
    });
  });

  it('운영 환경 stub 우회는 provider 생성 전에 실패한다', () => {
    expect(() =>
      createAligoProvider(
        config({
          NODE_ENV: 'production',
          ROUND_DIRECT_E2E_ENABLED: 'true',
          ROUND_DIRECT_E2E_ENV: 'preview',
          ROUND_DIRECT_E2E_PROVIDER_MODE: 'stub',
          ROUND_DIRECT_E2E_SHARED_SECRET: '비공개',
        }),
      ),
    ).toThrow('운영 환경에서는 회차 E2E provider 대역을 사용할 수 없습니다.');
  });
});
