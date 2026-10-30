import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  RuntimeConfigurationError,
  resolveSchedulerTriggerSettings,
} from '../config/runtime-config';
import { EngagementService } from '../engagement/engagement.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OpsDigestService } from '../ops-alerts/ops-digest.service';
import { PaymentsService } from '../payments/payments.service';
import { RetentionService } from '../retention/retention.service';
import { SettlementsService } from '../settlements/settlements.service';
import { ScheduledJobsController } from './scheduled-jobs.controller';
import { ScheduledJobsService } from './scheduled-jobs.service';
import {
  SCHEDULER_ID_TOKEN_VERIFIER,
  type SchedulerIdTokenVerifier,
  SchedulerInvokerGuard,
} from './scheduler-invoker.guard';

const INVOKER = 'greenhub-scheduler@green-e4fe3.iam.gserviceaccount.com';
const AUDIENCE = 'https://greenhub-api-988412563635.asia-northeast3.run.app';
const VALID_TOKEN = 'valid-id-token';

const enabledConfig = {
  GREENHUB_SCHEDULES_ENABLED: 'false',
  GREENHUB_SCHEDULER_INVOKER_EMAIL: INVOKER,
  GREENHUB_SCHEDULER_AUDIENCE: AUDIENCE,
};

function makeServices() {
  return {
    payments: { cleanupPendingOrders: jest.fn().mockResolvedValue(undefined) },
    notifications: {
      processGroupBuyDeadlines: jest.fn().mockResolvedValue(undefined),
      notifyDeadlineSoon: jest.fn().mockResolvedValue(undefined),
    },
    settlements: { confirmDueSettlements: jest.fn().mockResolvedValue(undefined) },
    retention: { runScheduledPurge: jest.fn().mockResolvedValue({ skipped: true }) },
    engagement: { runScheduledPartnerInquiryPurge: jest.fn().mockResolvedValue(undefined) },
    opsDigest: { sendDailyDigest: jest.fn().mockResolvedValue(undefined) },
  };
}

async function makeApp(config: Record<string, string>, verify: SchedulerIdTokenVerifier) {
  const services = makeServices();
  const moduleRef = await Test.createTestingModule({
    controllers: [ScheduledJobsController],
    providers: [
      ScheduledJobsService,
      SchedulerInvokerGuard,
      { provide: SCHEDULER_ID_TOKEN_VERIFIER, useValue: verify },
      { provide: ConfigService, useValue: { get: (key: string) => config[key] } },
      { provide: PaymentsService, useValue: services.payments },
      { provide: NotificationsService, useValue: services.notifications },
      { provide: SettlementsService, useValue: services.settlements },
      { provide: RetentionService, useValue: services.retention },
      { provide: EngagementService, useValue: services.engagement },
      { provide: OpsDigestService, useValue: services.opsDigest },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return { app, services };
}

describe('Cloud Scheduler 정기 작업 경로', () => {
  let app: INestApplication<App> | undefined;
  const verify = jest.fn<
    ReturnType<SchedulerIdTokenVerifier>,
    Parameters<SchedulerIdTokenVerifier>
  >();

  beforeEach(() => {
    verify.mockReset().mockImplementation(async (token, audience) => {
      if (token !== VALID_TOKEN) throw new Error('Wrong number of segments in token');
      return { email: INVOKER, email_verified: true, aud: audience } as never;
    });
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('허용한 서비스 계정 token이면 이름이 같은 작업을 끝까지 돌리고 204로 답한다', async () => {
    const harness = await makeApp(enabledConfig, verify);
    app = harness.app;

    await request(app.getHttpServer())
      .post('/internal/scheduled-jobs/payments-cleanup-pending-orders')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .expect(204);

    expect(verify).toHaveBeenCalledWith(VALID_TOKEN, AUDIENCE);
    expect(harness.services.payments.cleanupPendingOrders).toHaveBeenCalledTimes(1);
    expect(harness.services.notifications.processGroupBuyDeadlines).not.toHaveBeenCalled();
  });

  it('7개 작업이 각 서비스의 정기 작업 메서드로 이어진다', async () => {
    const harness = await makeApp(enabledConfig, verify);
    app = harness.app;
    const { services } = harness;
    const expected = {
      'payments-cleanup-pending-orders': services.payments.cleanupPendingOrders,
      'group-buy-deadlines': services.notifications.processGroupBuyDeadlines,
      'group-buy-deadline-soon': services.notifications.notifyDeadlineSoon,
      'settlements-confirm-due': services.settlements.confirmDueSettlements,
      'retention-purge': services.retention.runScheduledPurge,
      'partner-inquiry-purge': services.engagement.runScheduledPartnerInquiryPurge,
      'ops-daily-digest': services.opsDigest.sendDailyDigest,
    };
    expect(app.get(ScheduledJobsService).jobNames().sort()).toEqual(Object.keys(expected).sort());

    for (const [jobName, method] of Object.entries(expected)) {
      await request(app.getHttpServer())
        .post(`/internal/scheduled-jobs/${jobName}`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(204);
      expect(method).toHaveBeenCalledTimes(1);
    }
  });

  it('없는 작업 이름이나 객체 기본 속성 이름은 404다', async () => {
    const harness = await makeApp(enabledConfig, verify);
    app = harness.app;

    for (const jobName of ['unknown-job', 'constructor', 'toString', '__proto__']) {
      await request(app.getHttpServer())
        .post(`/internal/scheduled-jobs/${jobName}`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(404);
    }
  });

  it('작업이 실패하면 2xx로 답하지 않아 Cloud Scheduler가 실패로 기록한다', async () => {
    const harness = await makeApp(enabledConfig, verify);
    app = harness.app;
    harness.services.settlements.confirmDueSettlements.mockRejectedValueOnce(new Error('boom'));

    await request(app.getHttpServer())
      .post('/internal/scheduled-jobs/settlements-confirm-due')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .expect(500);
  });

  it('token이 없거나 검증에 실패하면 401이고 작업을 돌리지 않는다', async () => {
    const harness = await makeApp(enabledConfig, verify);
    app = harness.app;
    const server = app.getHttpServer();
    const path = '/internal/scheduled-jobs/payments-cleanup-pending-orders';

    await request(server).post(path).expect(401);
    await request(server).post(path).set('Authorization', 'Basic abc').expect(401);
    await request(server).post(path).set('Authorization', 'Bearer forged-token').expect(401);
    expect(harness.services.payments.cleanupPendingOrders).not.toHaveBeenCalled();
  });

  it('서명은 맞아도 다른 계정이거나 이메일 확인이 없으면 401이다', async () => {
    const harness = await makeApp(enabledConfig, verify);
    app = harness.app;
    const path = '/internal/scheduled-jobs/payments-cleanup-pending-orders';

    verify.mockResolvedValueOnce({
      email: 'someone-else@green-e4fe3.iam.gserviceaccount.com',
      email_verified: true,
    } as never);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .expect(401);

    verify.mockResolvedValueOnce({ email: INVOKER, email_verified: false } as never);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .expect(401);

    verify.mockResolvedValueOnce(undefined);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .expect(401);

    expect(harness.services.payments.cleanupPendingOrders).not.toHaveBeenCalled();
  });

  it('예약 호출 설정이 없는 호스트(Railway)에서는 경로가 없는 것처럼 404이고 token도 보지 않는다', async () => {
    const harness = await makeApp({ GREENHUB_SCHEDULES_ENABLED: 'true' }, verify);
    app = harness.app;

    await request(app.getHttpServer())
      .post('/internal/scheduled-jobs/payments-cleanup-pending-orders')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .expect(404);
    expect(verify).not.toHaveBeenCalled();
    expect(harness.services.payments.cleanupPendingOrders).not.toHaveBeenCalled();
  });
});

describe('예약 호출 설정 fail-closed', () => {
  it('둘 다 비어 있으면 끈 것이다', () => {
    expect(resolveSchedulerTriggerSettings({})).toBeNull();
    expect(resolveSchedulerTriggerSettings({ GREENHUB_SCHEDULES_ENABLED: 'false' })).toBeNull();
  });

  it('맞는 설정이면 호출 계정과 수신자를 돌려준다', () => {
    expect(resolveSchedulerTriggerSettings(enabledConfig)).toEqual({
      invokerEmail: INVOKER,
      audience: AUDIENCE,
    });
  });

  it.each([
    [
      '호출 계정만',
      { GREENHUB_SCHEDULES_ENABLED: 'false', GREENHUB_SCHEDULER_INVOKER_EMAIL: INVOKER },
    ],
    ['수신자만', { GREENHUB_SCHEDULES_ENABLED: 'false', GREENHUB_SCHEDULER_AUDIENCE: AUDIENCE }],
    [
      '서비스 계정이 아닌 이메일',
      { ...enabledConfig, GREENHUB_SCHEDULER_INVOKER_EMAIL: 'user@gmail.com' },
    ],
    ['http 수신자', { ...enabledConfig, GREENHUB_SCHEDULER_AUDIENCE: 'http://api.example.test' }],
    [
      '경로가 붙은 수신자',
      { ...enabledConfig, GREENHUB_SCHEDULER_AUDIENCE: `${AUDIENCE}/internal` },
    ],
    ['서버 안 정기 작업도 켜짐', { ...enabledConfig, GREENHUB_SCHEDULES_ENABLED: 'true' }],
    ['서버 안 정기 작업 값 없음(기본 켜짐)', { ...enabledConfig, GREENHUB_SCHEDULES_ENABLED: '' }],
  ])('%s이면 기동을 막는다', (_label, values) => {
    expect(() => resolveSchedulerTriggerSettings(values)).toThrow(RuntimeConfigurationError);
  });
});
