import { ConfigService } from '@nestjs/config';
import { E2EAligoClient } from './e2e-aligo.client';

const templateCode = 'ROUND_ORDER_CONFIRMED';
const baseVariables = {
  orderId: 'E2E-001',
};

function client() {
  return new E2EAligoClient(
    new ConfigService({
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
}

describe('알림 E2E 대역 계약', () => {
  it('알림톡 즉시 성공을 기록한다', async () => {
    const aligo = client();
    await expect(
      aligo.sendAlimtalk('01000000000', templateCode, {
        ...baseVariables,
        e2eScenario: 'alimtalk_success',
      }),
    ).resolves.toMatchObject({
      success: true,
      channel: 'alimtalk',
      alimtalkAttempts: 1,
      smsAttempts: 0,
    });
  });

  it('알림톡 3회 실패 뒤 문자 성공을 기록한다', async () => {
    const aligo = client();
    await expect(
      aligo.sendAlimtalk('01000000000', templateCode, {
        ...baseVariables,
        e2eScenario: 'alimtalk_retry_sms_success',
      }),
    ).resolves.toMatchObject({
      success: true,
      channel: 'sms',
      alimtalkAttempts: 3,
      smsAttempts: 1,
    });
  });

  it('알림톡과 문자 최종 실패를 결정적으로 기록하고 전화번호를 증거에서 제외한다', async () => {
    const aligo = client();
    await expect(
      aligo.sendAlimtalk('01012345678', templateCode, {
        ...baseVariables,
        e2eScenario: 'final_failure',
      }),
    ).resolves.toMatchObject({
      success: false,
      channel: null,
      alimtalkAttempts: 3,
      smsAttempts: 1,
    });
    const evidence = aligo.getCallEvidence();
    expect(evidence).toHaveLength(1);
    expect(evidence[0].templateCode).toBe(templateCode);
    expect(JSON.stringify(evidence)).not.toContain('01012345678');
  });
});
