import { ConfigService } from '@nestjs/config';
import {
  E2EProviderModeError,
  resolveE2EProviderMode,
} from './e2e-provider-mode';
import { E2EPortoneClient } from '../payments/e2e-portone.client';

function config(values: Record<string, string | undefined>) {
  return new ConfigService(values);
}

const valid = {
  NODE_ENV: 'test',
  RAILWAY_ENVIRONMENT_NAME: 'staging',
  ROUND_DIRECT_E2E_ENABLED: 'true',
  ROUND_DIRECT_E2E_ENV: 'preview',
  ROUND_DIRECT_E2E_PROVIDER_MODE: 'stub',
  ROUND_DIRECT_E2E_SHARED_SECRET: '비공개',
  FIREBASE_PROJECT_ID: 'green-staging-74557',
  ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS: 'green-staging-74557',
  ROUND_DIRECT_E2E_RUN_ID: 'task-6-7-run-001',
};

describe('회차 E2E provider mode 보안 계약', () => {
  it('완전한 비운영 stub 설정만 활성화한다', () => {
    expect(resolveE2EProviderMode(config(valid))).toEqual({
      enabled: true,
      mode: 'stub',
      runId: 'task-6-7-run-001',
      firebaseProjectId: 'green-staging-74557',
    });
  });

  it.each([
    [
      '플랫폼 표식 없는 NODE_ENV 운영',
      { NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: '' },
    ],
    ['Railway 운영', { RAILWAY_ENVIRONMENT_NAME: 'production' }],
    ['운영 Firebase', { FIREBASE_PROJECT_ID: 'green-e4fe3' }],
  ])('%s 환경의 대역 활성화를 거부한다', (_name, override) => {
    expect(() => resolveE2EProviderMode(config({ ...valid, ...override }))).toThrow(
      E2EProviderModeError,
    );
  });

  it('Railway staging은 빌드용 NODE_ENV가 production이어도 대역을 허용한다', () => {
    expect(resolveE2EProviderMode(config({ ...valid, NODE_ENV: 'production' }))).toEqual({
      enabled: true,
      mode: 'stub',
      runId: 'task-6-7-run-001',
      firebaseProjectId: 'green-staging-74557',
    });
  });

  it('비운영 회차 E2E의 실제 provider 연결을 거부한다', () => {
    expect(() =>
      resolveE2EProviderMode(
        config({ ...valid, ROUND_DIRECT_E2E_PROVIDER_MODE: 'live' }),
      ),
    ).toThrow('회차 E2E는 stub provider mode만 허용합니다.');
  });

  it.each([
    ['Preview 표식', { ROUND_DIRECT_E2E_ENV: 'staging' }],
    ['공유 secret', { ROUND_DIRECT_E2E_SHARED_SECRET: '' }],
    ['허용 프로젝트', { ROUND_DIRECT_E2E_ALLOWED_FIREBASE_PROJECTS: 'other-staging' }],
    ['실행 ID', { ROUND_DIRECT_E2E_RUN_ID: '' }],
  ])('%s 누락을 fail-closed로 거부한다', (_name, override) => {
    expect(() => resolveE2EProviderMode(config({ ...valid, ...override }))).toThrow(
      E2EProviderModeError,
    );
  });

  it('회차 E2E가 비활성이고 stub도 아니면 기존 provider를 유지한다', () => {
    expect(
      resolveE2EProviderMode(
        config({
          NODE_ENV: 'development',
          ROUND_DIRECT_E2E_ENABLED: 'false',
          ROUND_DIRECT_E2E_PROVIDER_MODE: 'live',
        }),
      ),
    ).toEqual({ enabled: false, mode: 'live' });
  });

  it('비활성 상태에서 stub만 설정한 우회도 거부한다', () => {
    expect(() =>
      resolveE2EProviderMode(
        config({
          NODE_ENV: 'development',
          ROUND_DIRECT_E2E_ENABLED: 'false',
          ROUND_DIRECT_E2E_PROVIDER_MODE: 'stub',
        }),
      ),
    ).toThrow(E2EProviderModeError);
  });
});

describe('PortOne E2E 대역 계약', () => {
  const paymentId = 'round-direct-e2e-task-6-7-run-001-payment-success';

  function client(overrides: Record<string, string> = {}) {
    return new E2EPortoneClient(
      config({
        ...valid,
        ROUND_DIRECT_E2E_PORTONE_FIXTURES_JSON: JSON.stringify({
          [paymentId]: {
            amount: 12000,
            lookupStatuses: ['PENDING', 'PAID'],
            refundResult: 'success',
          },
          'round-direct-e2e-task-6-7-run-001-payment-refund-failure': {
            amount: 3000,
            status: 'PAID',
            refundResult: 'failure',
          },
        }),
        ...overrides,
      }),
    );
  }

  it('재조회 상태를 순서대로 반환하고 마지막 상태를 유지한다', async () => {
    const portone = client();
    await expect(portone.getPayment(paymentId)).resolves.toMatchObject({ status: 'PENDING' });
    await expect(portone.getPayment(paymentId)).resolves.toMatchObject({ status: 'PAID' });
    await expect(portone.getPayment(paymentId)).resolves.toMatchObject({ status: 'PAID' });
  });

  it('성공 환불 뒤 조회를 CANCELLED로 고정한다', async () => {
    const portone = client();
    await portone.refund(paymentId, 12000, '테스트 환불');
    await expect(portone.getPayment(paymentId)).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(portone.getCallEvidence()).toEqual([
      { action: 'refund', paymentId, sequence: 1, result: 'success' },
      { action: 'getPayment', paymentId, sequence: 2, result: 'CANCELLED' },
    ]);
  });

  it('fixture 환불 실패와 실행 범위 밖 결제를 결정적으로 거부한다', async () => {
    const portone = client();
    await expect(
      portone.refund(
        'round-direct-e2e-task-6-7-run-001-payment-refund-failure',
        3000,
        '실패 분기',
      ),
    ).rejects.toMatchObject({ type: 'E2E_REFUND_FAILED' });
    await expect(portone.getPayment('production-payment')).rejects.toMatchObject({
      type: 'E2E_PAYMENT_OUT_OF_SCOPE',
    });
  });
});
