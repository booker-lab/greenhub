// 운영 기록 수동 닫기(POST /stores/:storeId/operation-issues/:issueId/resolve)를 HTTP 경계에서 증명한다.
// 실제 OperationsController·OperationsService·RolesGuard·전역 ValidationPipe를 띄우고,
// 인증 가드만 요청 헤더의 테스트 사용자를 req.user로 넣도록 바꾼다. 저장은 in-memory Firestore가 한다.

import { createHash } from 'node:crypto';
import { type ExecutionContext, type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { FirestoreService } from '../firestore/firestore.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { OperationIssueWriterService } from './operation-issue-writer.service';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

type Data = Record<string, unknown>;

const USERS: Record<string, { sub: string; role: string }> = {
  seller: { sub: 'seller-1', role: 'seller' },
  otherSeller: { sub: 'seller-2', role: 'seller' },
  admin: { sub: 'admin-1', role: 'admin' },
  consumer: { sub: 'consumer-1', role: 'consumer' },
};

const baseIssue = {
  id: 'issue-1',
  storeId: 'store-1',
  orderId: 'order-1',
  paymentId: 'order-1',
  type: 'DELIVERY_PHOTO_RECONCILIATION_REQUIRED',
  severity: 'critical',
  status: 'OPEN',
  idempotencyKey: 'delivery-photo:order-1',
  latestSnapshot: { orderStatus: 'DELIVERING' },
  actions: [],
  resolvedAt: null,
  createdAt: '2026-10-10T01:00:00.000Z',
  updatedAt: '2026-10-10T01:00:00.000Z',
};

function seed(issue: Data = {}): Record<string, Data> {
  return {
    'stores/store-1': { ownerId: 'seller-1' },
    'stores/store-2': { ownerId: 'seller-2' },
    'operationIssues/issue-1': { ...baseIssue, ...issue },
  };
}

describe('POST /stores/:storeId/operation-issues/:issueId/resolve', () => {
  let app: INestApplication<App>;
  let memory: ReturnType<typeof createInMemoryFirestore>;
  const payments = {
    processRefundByOrderId: jest.fn(),
    refundOrderChargesByOrderId: jest.fn(),
  };
  const notifications = { resendSms: jest.fn() };

  async function boot(initial: Record<string, Data>) {
    memory = createInMemoryFirestore(initial);
    const module = await Test.createTestingModule({
      controllers: [OperationsController],
      providers: [
        OperationsService,
        { provide: FirestoreService, useValue: memory.firestore },
        { provide: PaymentsService, useValue: payments },
        { provide: NotificationsService, useValue: notifications },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          const user = USERS[String(req.headers['x-test-user'])];
          if (!user) return false;
          req.user = user;
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(sanitizedValidationPipeOptions()));
    await app.init();
  }

  afterEach(async () => {
    jest.clearAllMocks();
    await app?.close();
  });

  function resolve(user: string, body: unknown, storeId = 'store-1', issueId = 'issue-1') {
    return request(app.getHttpServer())
      .post(`/stores/${storeId}/operation-issues/${issueId}/resolve`)
      .set('x-test-user', user)
      .send(body as object);
  }

  function stored() {
    return memory.read('operationIssues/issue-1') as Data;
  }

  it('판매자는 자기 가게 기록을 메모와 함께 RESOLVED로 닫고 누가·언제·메모를 남긴다', async () => {
    await boot(seed());

    const response = await resolve('seller', { memo: '  고객과 통화해 사진 다시 확인함  ' }).expect(
      200,
    );

    expect(response.body).toMatchObject({
      id: 'issue-1',
      status: 'RESOLVED',
      resolution: {
        method: 'MANUAL',
        actorId: 'seller-1',
        actorRole: 'seller',
        memo: '고객과 통화해 사진 다시 확인함',
      },
    });
    expect(response.body.resolvedAt).toBeTruthy();
    expect(response.body.resolution.resolvedAt).toBe(response.body.resolvedAt);
    // 기존 판매자 앱 파서가 모르는 조치 유형으로 기록 전체를 버리지 않도록 actions는 건드리지 않는다.
    expect(response.body.actions).toEqual([]);

    const record = stored();
    expect(record).toMatchObject({
      status: 'RESOLVED',
      actionClaim: null,
      resolution: { method: 'MANUAL', actorId: 'seller-1', actorRole: 'seller' },
    });
    expect(record['resolutionHistory']).toHaveLength(1);
    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(notifications.resendSms).not.toHaveBeenCalled();
  });

  it('닫은 기록은 목록에서 열린 기록이 아니고 해결 경위가 함께 보인다', async () => {
    await boot(seed());
    await resolve('seller', { memo: '확인 완료' }).expect(200);

    const list = await request(app.getHttpServer())
      .get('/stores/store-1/operation-issues')
      .set('x-test-user', 'seller')
      .expect(200);

    expect(list.body.items).toEqual([
      expect.objectContaining({
        id: 'issue-1',
        status: 'RESOLVED',
        resolution: expect.objectContaining({ memo: '확인 완료', actorRole: 'seller' }),
      }),
    ]);
  });

  it('이미 닫힌 기록은 다시 닫아도 처음 경위를 그대로 돌려주고 바꾸지 않는다', async () => {
    await boot(seed());
    const first = await resolve('seller', { memo: '첫 메모' }).expect(200);
    const second = await resolve('admin', { memo: '두 번째 메모' }).expect(200);

    expect(second.body.resolution).toEqual(first.body.resolution);
    expect(stored()['resolutionHistory']).toHaveLength(1);
  });

  it('동시에 닫아도 한 번만 기록한다', async () => {
    await boot(seed());

    const responses = await Promise.all([
      resolve('seller', { memo: '동시 1' }),
      resolve('admin', { memo: '동시 2' }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses[0].body.resolution).toEqual(responses[1].body.resolution);
    expect(stored()['resolutionHistory']).toHaveLength(1);
  });

  it('다른 가게 판매자는 403, 다른 가게 경로로 부르면 404이고 기록은 그대로다', async () => {
    await boot(seed());

    await resolve('otherSeller', { memo: '남의 기록' }).expect(403);
    await resolve('otherSeller', { memo: '남의 기록' }, 'store-2').expect(404);
    await resolve('admin', { memo: '가게 불일치' }, 'store-2').expect(404);

    expect(stored()).toMatchObject({ status: 'OPEN' });
    expect(stored()['resolution']).toBeUndefined();
  });

  it('판매자·관리자가 아닌 역할은 닫을 수 없다', async () => {
    await boot(seed());

    await resolve('consumer', { memo: '닫기' }).expect(403);
    expect(stored()).toMatchObject({ status: 'OPEN' });
  });

  it('결제사 취소·분쟁 기록은 판매자가 닫을 수 없고 관리자는 닫을 수 있다', async () => {
    await boot(seed({ type: 'PROVIDER_REVERSAL_DETECTED' }));

    await resolve('seller', { memo: '정산 받고 싶어요' }).expect(403);
    expect(stored()).toMatchObject({ status: 'OPEN' });

    const response = await resolve('admin', { memo: 'PortOne 콘솔에서 분쟁 종결 확인' }).expect(
      200,
    );
    expect(response.body.resolution).toMatchObject({ actorId: 'admin-1', actorRole: 'admin' });
  });

  it('관리자는 어느 가게 기록이든 닫는다', async () => {
    await boot({
      ...seed(),
      'operationIssues/issue-2': { ...baseIssue, id: 'issue-2', storeId: 'store-2' },
    });

    const response = await resolve('admin', { memo: '관리자 확인' }, 'store-2', 'issue-2').expect(
      200,
    );
    expect(response.body).toMatchObject({ storeId: 'store-2', status: 'RESOLVED' });
  });

  it.each([
    ['메모 없음', {}],
    ['빈 메모', { memo: '' }],
    ['공백 메모', { memo: '   ' }],
    ['줄바꿈', { memo: '첫 줄\n둘째 줄' }],
    ['제어문자', { memo: `메모${String.fromCharCode(7)}` }],
    ['길이 초과', { memo: '가'.repeat(201) }],
    ['문자열 아님', { memo: 123 }],
    ['수행자 주입', { memo: '메모', actorId: 'seller-2' }],
  ])('%s 본문은 400으로 거부하고 기록을 바꾸지 않는다', async (_label, body) => {
    await boot(seed());

    await resolve('seller', body).expect(400);
    expect(stored()).toMatchObject({ status: 'OPEN' });
  });

  it('200자 메모는 받는다', async () => {
    await boot(seed());

    const response = await resolve('seller', { memo: '가'.repeat(200) }).expect(200);
    expect(response.body.resolution.memo).toHaveLength(200);
  });

  it('환불 재시도가 진행 중이면 409로 거부하고 claim을 그대로 둔다', async () => {
    const claim = { token: 'claim-1', actionType: 'RETRY_REFUND', expiresAt: Date.now() + 60_000 };
    await boot(seed({ type: 'AUTO_REFUND_FAILED', actionClaim: claim }));

    await resolve('seller', { memo: '환불 확인' }).expect(409);
    expect(stored()).toMatchObject({ status: 'OPEN', actionClaim: claim });
  });

  it('만료된 claim은 비우고 닫아, 늦게 끝난 이전 조치가 기록을 덮지 못하게 한다', async () => {
    const claim = { token: 'claim-1', actionType: 'RETRY_REFUND', expiresAt: Date.now() - 1 };
    await boot(seed({ type: 'AUTO_REFUND_FAILED', actionClaim: claim }));

    await resolve('seller', { memo: 'PortOne에서 직접 환불함' }).expect(200);
    expect(stored()).toMatchObject({ status: 'RESOLVED', actionClaim: null });
  });

  it('수동으로 닫은 기록에 자동 조치를 다시 불러도 외부 부작용이 없다', async () => {
    await boot(seed({ type: 'AUTO_REFUND_FAILED' }));
    await resolve('seller', { memo: '직접 환불 확인' }).expect(200);

    await request(app.getHttpServer())
      .post('/stores/store-1/operation-issues/issue-1/actions')
      .set('x-test-user', 'seller')
      .send({ actionType: 'RETRY_REFUND' })
      .expect(201);

    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ status: 'RESOLVED' });
  });

  it('같은 원인이 다시 생기면 다시 열리고 이전 해결 경위는 응답에서 빠지되 이력은 남는다', async () => {
    // 작성기는 idempotencyKey 해시를 문서 ID로 쓰므로 그 ID에 기록을 둔다.
    const issueId = createHash('sha256')
      .update(baseIssue.idempotencyKey)
      .digest('hex')
      .slice(0, 32);
    await boot({
      'stores/store-1': { ownerId: 'seller-1' },
      [`operationIssues/${issueId}`]: { ...baseIssue, id: issueId },
    });
    await resolve('seller', { memo: '사진 확인' }, 'store-1', issueId).expect(200);

    const writer = new OperationIssueWriterService(memory.firestore as never);
    await writer.createOrMergeIssue({
      storeId: 'store-1',
      orderId: 'order-1',
      paymentId: 'order-1',
      type: 'DELIVERY_PHOTO_RECONCILIATION_REQUIRED',
      severity: 'critical',
      idempotencyKey: baseIssue.idempotencyKey,
    });

    const reopened = memory.read(`operationIssues/${issueId}`) as Data;
    expect(reopened).toMatchObject({ status: 'OPEN', resolution: null, resolvedAt: null });
    expect(reopened['resolutionHistory']).toEqual([
      expect.objectContaining({ memo: '사진 확인', actorId: 'seller-1' }),
    ]);

    const detail = await request(app.getHttpServer())
      .get(`/stores/store-1/operation-issues/${issueId}`)
      .set('x-test-user', 'seller')
      .expect(200);
    expect(detail.body).toMatchObject({ status: 'OPEN', resolution: null });
  });
});
