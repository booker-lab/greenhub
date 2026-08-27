import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuditService } from '../common/audit/audit.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PortoneClient } from './portone.client';

type WebhookRequest = {
  rawBody: Buffer;
  webhookId: string;
  webhookTimestamp: string;
  webhookSignature: string;
};

type SideEffectName =
  | 'orderMutation'
  | 'paymentMutation'
  | 'orderChargeMutation'
  | 'capacityMutation';

const FIXED_NOW_MS = Date.parse('2026-08-27T12:00:00.000Z');
const WEBHOOK_SECRET_BYTES = Buffer.from('synthetic-portone-webhook-secret', 'utf8');
const WEBHOOK_SECRET = `whsec_${WEBHOOK_SECRET_BYTES.toString('base64')}`;
const DEFAULT_RAW_BODY = Buffer.from(
  '{\n  "type": "Transaction.Paid",\n  "data": { "paymentId": "payment-1", "storeId": "store-1" }\n}\n',
  'utf8',
);

const sideEffects: Record<SideEffectName, number> = {
  orderMutation: 0,
  paymentMutation: 0,
  orderChargeMutation: 0,
  capacityMutation: 0,
};

const paymentsService = {
  handleWebhook: jest.fn(async () => {
    sideEffects.orderMutation += 1;
    sideEffects.paymentMutation += 1;
    sideEffects.orderChargeMutation += 1;
    sideEffects.capacityMutation += 1;
    return { ok: true };
  }),
};

const auditService = {
  log: jest.fn().mockResolvedValue(undefined),
};

function timestampAtOffset(offsetSeconds: number): string {
  return String(Math.floor(FIXED_NOW_MS / 1000) + offsetSeconds);
}

function signWebhook(webhookId: string, webhookTimestamp: string, rawBody: Buffer): string {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET_BYTES)
    .update(`${webhookId}.${webhookTimestamp}.${rawBody.toString()}`)
    .digest('base64');
}

function createSignedWebhook(
  options: { rawBody?: Buffer; webhookId?: string; webhookTimestamp?: string } = {},
): WebhookRequest {
  const rawBody = Buffer.from(options.rawBody ?? DEFAULT_RAW_BODY);
  const webhookId = options.webhookId ?? 'webhook-boundary-1';
  const webhookTimestamp = options.webhookTimestamp ?? timestampAtOffset(0);
  return {
    rawBody,
    webhookId,
    webhookTimestamp,
    webhookSignature: `v1,${signWebhook(webhookId, webhookTimestamp, rawBody)}`,
  };
}

function invalidHmacHeader(): string {
  return `v1,${Buffer.alloc(32, 0).toString('base64')}`;
}

function mutateRawBody(rawBody: Buffer): Buffer {
  const mutated = rawBody.toString('utf8').replace('payment-1', 'payment-2');
  if (mutated === rawBody.toString('utf8')) {
    throw new Error('테스트 raw body 변조 대상이 없습니다.');
  }
  return Buffer.from(mutated, 'utf8');
}

function mutateSignature(signatureHeader: string): string {
  const encodedSignature = signatureHeader.slice(signatureHeader.indexOf(',') + 1);
  const replacement = encodedSignature[0] === 'A' ? 'B' : 'A';
  return `v1,${replacement}${encodedSignature.slice(1)}`;
}

function resetSideEffects(): void {
  sideEffects.orderMutation = 0;
  sideEffects.paymentMutation = 0;
  sideEffects.orderChargeMutation = 0;
  sideEffects.capacityMutation = 0;
}

function expectBusinessBoundaryClosed(): void {
  expect(paymentsService.handleWebhook).not.toHaveBeenCalled();
  expect(sideEffects).toEqual({
    orderMutation: 0,
    paymentMutation: 0,
    orderChargeMutation: 0,
    capacityMutation: 0,
  });
}

const signedRequestMutations: Array<[string, (webhook: WebhookRequest) => WebhookRequest]> = [
  ['raw body 1바이트', (webhook) => ({ ...webhook, rawBody: mutateRawBody(webhook.rawBody) })],
  ['webhook id', (webhook) => ({ ...webhook, webhookId: `${webhook.webhookId}-tampered` })],
  [
    'signed timestamp',
    (webhook) => ({
      ...webhook,
      webhookTimestamp: String(Number(webhook.webhookTimestamp) + 1),
    }),
  ],
  [
    'signature',
    (webhook) => ({ ...webhook, webhookSignature: mutateSignature(webhook.webhookSignature) }),
  ],
];

const timestampCases: Array<[string, number, number]> = [
  ['허용 창 안쪽 299초', -299, 200],
  ['과거 정확히 5분 경계', -300, 200],
  ['미래 정확히 5분 경계', 300, 200],
  ['과거 허용 창 밖 301초', -301, 401],
  ['미래 허용 창 밖 301초', 301, 401],
];

describe('P2 PAY-02 PortOne 웹훅 서명 경계', () => {
  let app: INestApplication;
  let portoneClient: PortoneClient;

  beforeAll(async () => {
    portoneClient = new PortoneClient(
      new ConfigService({ PORTONE_WEBHOOK_SECRET: WEBHOOK_SECRET }),
    );

    const module = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: paymentsService },
        { provide: PortoneClient, useValue: portoneClient },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    app = module.createNestApplication({ rawBody: true });
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetSideEffects();
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  function postWebhook(webhook: WebhookRequest) {
    return request(app.getHttpServer())
      .post('/payments/webhook/portone')
      .set('Content-Type', 'application/json')
      .set('webhook-id', webhook.webhookId)
      .set('webhook-timestamp', webhook.webhookTimestamp)
      .set('webhook-signature', webhook.webhookSignature)
      .send(webhook.rawBody.toString('utf8'));
  }

  it('production bootstrap이 rawBody를 활성화하고 실제 raw bytes를 verifier에 전달한다', async () => {
    const mainSource = readFileSync(resolve(__dirname, '../main.ts'), 'utf8');
    expect(mainSource).toMatch(/NestFactory\.create\(AppModule,\s*\{\s*rawBody:\s*true\s*\}\)/);

    const webhook = createSignedWebhook();
    const verifySpy = jest.spyOn(portoneClient, 'verifyWebhookSignature');
    const response = await postWebhook(webhook);

    expect(response.status).toBe(200);
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy.mock.calls[0][0]).toBe(webhook.webhookId);
    expect(verifySpy.mock.calls[0][1]).toBe(webhook.webhookTimestamp);
    expect(Buffer.isBuffer(verifySpy.mock.calls[0][2])).toBe(true);
    expect(verifySpy.mock.calls[0][2]).toEqual(webhook.rawBody);
    expect(verifySpy.mock.calls[0][3]).toBe(webhook.webhookSignature);
    expect(paymentsService.handleWebhook).toHaveBeenCalledWith({
      type: 'Transaction.Paid',
      data: { paymentId: 'payment-1', storeId: 'store-1' },
    });
  });

  it('실제 PortoneClient가 생성한 known-valid HMAC을 통과시킨다', async () => {
    const response = await postWebhook(createSignedWebhook());

    expect(response.status).toBe(200);
    expect(paymentsService.handleWebhook).toHaveBeenCalledTimes(1);
    expect(sideEffects).toEqual({
      orderMutation: 1,
      paymentMutation: 1,
      orderChargeMutation: 1,
      capacityMutation: 1,
    });
  });

  it('필수 헤더가 모두 존재해도 non-empty invalid HMAC은 거부하고 업무 경계에 도달하지 않는다', async () => {
    const webhook = createSignedWebhook();
    webhook.webhookSignature = invalidHmacHeader();

    const response = await postWebhook(webhook);

    expect(response.status).toBe(401);
    expect(auditService.log).toHaveBeenCalledWith(
      'payment.webhook.invalid_sig',
      expect.objectContaining({
        detail: expect.objectContaining({
          webhookId: webhook.webhookId,
          webhookTimestamp: webhook.webhookTimestamp,
        }),
      }),
    );
    expectBusinessBoundaryClosed();
  });

  it.each(
    signedRequestMutations,
  )('유효하게 서명된 요청에서 %s만 변조하면 거부하고 업무 경계에 도달하지 않는다', async (_label, mutate) => {
    const response = await postWebhook(mutate(createSignedWebhook()));

    expect(response.status).toBe(401);
    expectBusinessBoundaryClosed();
  });

  it.each(
    timestampCases,
  )('timestamp %s는 실제 verifier의 ±5분 계약에 따라 처리한다', async (_label, offsetSeconds, expectedStatus) => {
    const response = await postWebhook(
      createSignedWebhook({ webhookTimestamp: timestampAtOffset(offsetSeconds) }),
    );

    expect(response.status).toBe(expectedStatus);
    if (expectedStatus === 200) {
      expect(paymentsService.handleWebhook).toHaveBeenCalledTimes(1);
    } else {
      expectBusinessBoundaryClosed();
    }
  });

  it('invalid cryptographic request의 order/payment/orderCharge/capacity 의미는 모두 0이다', async () => {
    const webhook = createSignedWebhook();
    webhook.webhookSignature = invalidHmacHeader();

    await postWebhook(webhook).expect(401);

    expect(paymentsService.handleWebhook).toHaveBeenCalledTimes(0);
    expect(sideEffects.orderMutation).toBe(0);
    expect(sideEffects.paymentMutation).toBe(0);
    expect(sideEffects.orderChargeMutation).toBe(0);
    expect(sideEffects.capacityMutation).toBe(0);
  });
});
