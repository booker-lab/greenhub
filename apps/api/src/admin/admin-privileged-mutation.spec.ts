import {
  BadRequestException,
  ConflictException,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { FirestoreService } from '../firestore/firestore.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

type Role = 'consumer' | 'seller' | 'driver' | 'admin';
type Actor = 'unauthenticated' | Exclude<Role, 'admin'>;
type Data = Record<string, any>;
type MutationName =
  | 'refund'
  | 'pay'
  | 'approveDriver'
  | 'suspendDriver'
  | 'setCommission'
  | 'archiveStore'
  | 'restoreStore'
  | 'suspendUser'
  | 'generateInvite'
  | 'revokeInvite'
  | 'upsertBanner';

const JWT_SECRET = 'admin-privileged-mutation-test-secret';
const SETTLEMENT_PATH = 'settlements/settlement-1';
const REVERSAL_QUERY_READ =
  'operationIssues?orderId==order-1&type==PROVIDER_REVERSAL_DETECTED&status==OPEN&limit=1';

function makeHttpHarness() {
  const users = new Map<string, Data>([
    ['admin-1', { id: 'admin-1', role: 'admin', storeId: null }],
    ['consumer-1', { id: 'consumer-1', role: 'consumer', storeId: null }],
    ['seller-1', { id: 'seller-1', role: 'seller', storeId: 'store-1' }],
    ['driver-1', { id: 'driver-1', role: 'driver', storeId: null, driverApproved: true }],
  ]);

  const firestoreWrites = {
    update: jest.fn(),
    set: jest.fn(),
    runTransaction: jest.fn(),
  };
  const firestore = {
    doc: jest.fn((path: string) => {
      const userId = path.startsWith('users/') ? path.slice('users/'.length) : '';
      return {
        path,
        get: jest.fn(async () => {
          const user = users.get(userId);
          return { exists: user !== undefined, data: () => user };
        }),
        update: firestoreWrites.update,
        set: firestoreWrites.set,
      };
    }),
    collection: jest.fn(),
    runTransaction: firestoreWrites.runTransaction,
    Timestamp: { now: jest.fn(() => 'now') },
    FieldValue: { delete: jest.fn() },
  };

  const payments = {
    processRefundByOrderId: jest.fn(),
  };
  const settlements = {
    cancelSettlement: jest.fn(),
  };
  const roundLifecycle = {
    cancelForRound: jest.fn(),
  };
  const adminService = new AdminService(
    firestore as never,
    payments as never,
    settlements as never,
    roundLifecycle as never,
    { logAdmin: jest.fn().mockResolvedValue(undefined), listAdmin: jest.fn() } as never,
  );

  const serviceBoundary = {
    forceRefund: jest.spyOn(adminService, 'forceRefund').mockResolvedValue({
      ok: true,
      orderId: 'order-1',
    }),
    markAsPaid: jest.spyOn(adminService, 'markAsPaid').mockResolvedValue({
      settlementId: 'settlement-1',
      status: 'paid',
    }),
    approveDriver: jest.spyOn(adminService, 'approveDriver').mockResolvedValue({
      userId: 'driver-1',
      driverApproved: true,
    }),
    suspendDriver: jest.spyOn(adminService, 'suspendDriver').mockResolvedValue({
      userId: 'driver-1',
      suspended: true,
    }),
    setCommission: jest.spyOn(adminService, 'setCommission').mockResolvedValue({
      storeId: 'store-1',
      commissionRate: 0.1,
    }),
    archiveStore: jest.spyOn(adminService, 'archiveStore').mockResolvedValue({
      storeId: 'store-1',
      status: 'archived',
    }),
    restoreStore: jest.spyOn(adminService, 'restoreStore').mockResolvedValue({
      storeId: 'store-1',
      status: 'active',
    }),
    suspendUser: jest.spyOn(adminService, 'suspendUser').mockResolvedValue({
      userId: 'consumer-1',
      suspended: true,
    }),
    generateInvite: jest.spyOn(adminService, 'generateInvite').mockResolvedValue({
      token: 'TESTINVITE12345678',
      expiresAt: new Date(0).toISOString(),
      recipientEmail: 'new-seller@example.com',
    }),
    revokeInvite: jest.spyOn(adminService, 'revokeInvite').mockResolvedValue({
      token: 'TESTINVITE123456',
      revokedAt: new Date(0).toISOString(),
    }),
    upsertBanner: jest.spyOn(adminService, 'upsertBanner').mockResolvedValue({
      headline: '검증 배너',
    }),
  };

  return { adminService, firestore, firestoreWrites, payments, roundLifecycle, serviceBoundary, settlements, users };
}

describe('Admin privileged mutation HTTP authorization boundary', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let harness: ReturnType<typeof makeHttpHarness>;

  beforeAll(async () => {
    harness = makeHttpHarness();
    const module = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({ secret: JWT_SECRET }),
      ],
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: harness.adminService },
        { provide: FirestoreService, useValue: harness.firestore },
        { provide: ConfigService, useValue: new ConfigService({ JWT_SECRET }) },
        JwtAuthGuard,
        RolesGuard,
        JwtStrategy,
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    jwt = app.get(JwtService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function tokenFor(actor: Exclude<Role, 'admin'> | 'admin') {
    return jwt.sign({ sub: `${actor}-1`, role: actor, storeId: actor === 'seller' ? 'store-1' : null });
  }

  function mutationRequest(name: MutationName) {
    const http = request(app.getHttpServer());
    switch (name) {
      case 'refund':
        return http.post('/admin/orders/order-1/refund').send({ reason: '검증 환불' });
      case 'pay':
        return http.patch(`/admin/settlements/${SETTLEMENT_PATH.slice('settlements/'.length)}/pay`);
      case 'approveDriver':
        return http.patch('/admin/drivers/driver-1/approve');
      case 'suspendDriver':
        return http.patch('/admin/drivers/driver-1/suspend').send({ suspended: true });
      case 'setCommission':
        return http.patch('/admin/stores/store-1/commission').send({ rate: 0.1 });
      case 'archiveStore':
        return http.patch('/admin/stores/store-1/archive');
      case 'restoreStore':
        return http.patch('/admin/stores/store-1/restore');
      case 'suspendUser':
        return http.patch('/admin/users/consumer-1/status').send({ suspended: true });
      case 'generateInvite':
        return http.post('/admin/invite').send({ recipientEmail: 'new-seller@example.com' });
      case 'revokeInvite':
        return http.post('/admin/invite/TESTINVITE123456/revoke');
      case 'upsertBanner':
        return http.put('/admin/banner').send({ headline: '검증 배너' });
    }
  }

  function callMutation(name: MutationName, actor: Actor | 'admin') {
    const test = mutationRequest(name);
    if (actor === 'unauthenticated') return test;
    return test.set('Authorization', `Bearer ${tokenFor(actor)}`);
  }

  function successStatus(name: MutationName) {
    return name === 'refund' || name === 'generateInvite' || name === 'revokeInvite' ? 201 : 200;
  }

  const mutations: MutationName[] = [
    'refund',
    'pay',
    'approveDriver',
    'suspendDriver',
    'setCommission',
    'archiveStore',
    'restoreStore',
    'suspendUser',
    'generateInvite',
    'revokeInvite',
    'upsertBanner',
  ];

  it.each(mutations)('%s는 인증되지 않은 요청을 401로 거부한다', async (name) => {
    await callMutation(name, 'unauthenticated').expect(401);

    expect(harness.serviceBoundary.forceRefund).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.markAsPaid).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.approveDriver).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.suspendDriver).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.setCommission).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.archiveStore).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.restoreStore).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.suspendUser).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.generateInvite).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.revokeInvite).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.upsertBanner).not.toHaveBeenCalled();
    expect(harness.payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(harness.settlements.cancelSettlement).not.toHaveBeenCalled();
    expect(harness.roundLifecycle.cancelForRound).not.toHaveBeenCalled();
    expect(harness.firestoreWrites.update).not.toHaveBeenCalled();
    expect(harness.firestoreWrites.set).not.toHaveBeenCalled();
    expect(harness.firestoreWrites.runTransaction).not.toHaveBeenCalled();
  });

  it.each(
    (['consumer', 'seller', 'driver'] as const).flatMap((actor) =>
      mutations.map((mutation) => [actor, mutation] as const),
    ),
  )('%s의 %s 요청은 403이고 privileged side effect가 0이다', async (actor, name) => {
    await callMutation(name, actor).expect(403);

    expect(harness.serviceBoundary.forceRefund).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.markAsPaid).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.approveDriver).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.suspendDriver).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.setCommission).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.archiveStore).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.restoreStore).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.suspendUser).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.generateInvite).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.revokeInvite).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.upsertBanner).not.toHaveBeenCalled();
    expect(harness.payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(harness.settlements.cancelSettlement).not.toHaveBeenCalled();
    expect(harness.roundLifecycle.cancelForRound).not.toHaveBeenCalled();
    expect(harness.firestoreWrites.update).not.toHaveBeenCalled();
    expect(harness.firestoreWrites.set).not.toHaveBeenCalled();
    expect(harness.firestoreWrites.runTransaction).not.toHaveBeenCalled();
  });

  it.each(mutations)('current admin의 %s 요청은 controller service boundary에 도달한다', async (name) => {
    await callMutation(name, 'admin').expect(successStatus(name));

    switch (name) {
      case 'refund':
        expect(harness.serviceBoundary.forceRefund).toHaveBeenCalledWith(
          'order-1',
          { reason: '검증 환불' },
          'admin-1',
        );
        break;
      case 'pay':
        expect(harness.serviceBoundary.markAsPaid).toHaveBeenCalledWith('settlement-1', 'admin-1');
        break;
      case 'approveDriver':
        expect(harness.serviceBoundary.approveDriver).toHaveBeenCalledWith('driver-1', 'admin-1');
        break;
      case 'suspendDriver':
        expect(harness.serviceBoundary.suspendDriver).toHaveBeenCalledWith(
          'driver-1',
          { suspended: true },
          'admin-1',
        );
        break;
      case 'setCommission':
        expect(harness.serviceBoundary.setCommission).toHaveBeenCalledWith('store-1', { rate: 0.1 }, 'admin-1');
        break;
      case 'archiveStore':
        expect(harness.serviceBoundary.archiveStore).toHaveBeenCalledWith('store-1', 'admin-1');
        break;
      case 'restoreStore':
        expect(harness.serviceBoundary.restoreStore).toHaveBeenCalledWith('store-1', 'admin-1');
        break;
      case 'suspendUser':
        expect(harness.serviceBoundary.suspendUser).toHaveBeenCalledWith(
          'consumer-1',
          { suspended: true },
          'admin-1',
        );
        break;
      case 'generateInvite':
        expect(harness.serviceBoundary.generateInvite).toHaveBeenCalledWith('admin-1', {
          recipientEmail: 'new-seller@example.com',
        });
        break;
      case 'revokeInvite':
        expect(harness.serviceBoundary.revokeInvite).toHaveBeenCalledWith(
          'TESTINVITE123456',
          'admin-1',
        );
        break;
      case 'upsertBanner':
        expect(harness.serviceBoundary.upsertBanner).toHaveBeenCalledWith({ headline: '검증 배너' }, 'admin-1');
        break;
    }
  });
});

type IssueQuery = {
  collectionName: string;
  filters: Array<[string, string, unknown]>;
  maximum?: number;
};

function makeMarkAsPaidFixture(status?: string, issues: Data[] = []) {
  const records = new Map<string, Data>();
  if (status !== undefined) {
    records.set(SETTLEMENT_PATH, { id: 'settlement-1', orderId: 'order-1', status });
  }
  for (const issue of issues) records.set(`operationIssues/${issue['id']}`, issue);

  const refs = new Map<string, Data>();
  const transactionReads: string[] = [];
  const transactionUpdates: Array<{ path: string; data: Data }> = [];
  let transactionTail = Promise.resolve();

  const doc = jest.fn((path: string) => {
    if (!refs.has(path)) refs.set(path, { path });
    return refs.get(path);
  });

  const makeQuery = (query: IssueQuery): Data => ({
    __query: query,
    where: (field: string, operator: string, value: unknown) =>
      makeQuery({ ...query, filters: [...query.filters, [field, operator, value]] }),
    limit: (maximum: number) => makeQuery({ ...query, maximum }),
  });
  const collection = jest.fn((collectionName: string) =>
    makeQuery({ collectionName, filters: [] }),
  );
  const runQuery = ({ collectionName, filters, maximum }: IssueQuery) => {
    const docs = [...records.entries()]
      .filter(([path]) => path.startsWith(`${collectionName}/`))
      .filter(([, data]) =>
        filters.every(([field, operator, value]) => operator === '==' && data[field] === value),
      )
      .slice(0, maximum)
      .map(([, data]) => ({ data: () => data }));
    return { empty: docs.length === 0, docs };
  };

  const runTransaction = jest.fn().mockImplementation((callback: (tx: Data) => Promise<unknown>) => {
    const execute = transactionTail.then(async () => {
      const pending = new Map<string, Data>();
      const tx = {
        get: jest.fn(async (ref: Data) => {
          if (ref['__query']) {
            const query = ref['__query'] as IssueQuery;
            const where = query.filters.map(([f, o, v]) => `${f}${o}${String(v)}`).join('&');
            transactionReads.push(`${query.collectionName}?${where}&limit=${query.maximum}`);
            return runQuery(query);
          }
          transactionReads.push(ref.path);
          const data = pending.get(ref.path) ?? records.get(ref.path);
          return { exists: data !== undefined, data: () => data, ref };
        }),
        update: jest.fn((ref: Data, data: Data) => {
          transactionUpdates.push({ path: ref.path, data });
          pending.set(ref.path, { ...(records.get(ref.path) ?? {}), ...data });
        }),
      };
      const result = await callback(tx);
      for (const [path, data] of pending) records.set(path, data);
      return result;
    });
    transactionTail = execute.then(
      () => undefined,
      () => undefined,
    );
    return execute;
  });

  const firestore = {
    doc,
    collection,
    runTransaction,
    Timestamp: { now: jest.fn(() => 'transaction-now') },
  };
  const audit = { logAdmin: jest.fn().mockResolvedValue(undefined), listAdmin: jest.fn() };
  const service = new AdminService(
    firestore as never,
    {} as never,
    {} as never,
    {} as never,
    audit as never,
  );

  return { audit, records, refs, runTransaction, service, transactionReads, transactionUpdates };
}

describe('AdminService.markAsPaid 상태 계약', () => {
  it.each([
    ['missing', undefined, '정산 내역을 찾을 수 없습니다.'],
    ['pending', 'pending', 'confirmed 상태의 정산만 지급 처리할 수 있습니다.'],
    ['cancelled', 'cancelled', 'confirmed 상태의 정산만 지급 처리할 수 있습니다.'],
    ['already paid', 'paid', '이미 지급 완료된 정산입니다.'],
  ] as const)('%s는 DENY하고 transaction write를 만들지 않는다', async (_label, status, message) => {
    const fixture = makeMarkAsPaidFixture(status);

    await expect(fixture.service.markAsPaid('settlement-1', 'admin-1')).rejects.toThrow(message);

    expect(fixture.transactionReads).toEqual([SETTLEMENT_PATH]);
    expect(fixture.transactionUpdates).toHaveLength(0);
  });

  it('confirmed는 transaction fresh read 후 paid로 전이하고 paidAt·updatedAt을 설정한다', async () => {
    const fixture = makeMarkAsPaidFixture('confirmed');

    await expect(fixture.service.markAsPaid('settlement-1', 'admin-1')).resolves.toEqual({
      settlementId: 'settlement-1',
      status: 'paid',
    });

    expect(fixture.transactionReads).toEqual([SETTLEMENT_PATH, REVERSAL_QUERY_READ]);
    expect(fixture.transactionUpdates).toEqual([
      {
        path: SETTLEMENT_PATH,
        data: {
          status: 'paid',
          paidAt: 'transaction-now',
          paidBy: 'admin-1',
          updatedAt: 'transaction-now',
        },
      },
    ]);
    expect(fixture.records.get(SETTLEMENT_PATH)).toMatchObject({
      status: 'paid',
      paidAt: 'transaction-now',
      paidBy: 'admin-1',
      updatedAt: 'transaction-now',
    });
    // 지급 기록은 같은 트랜잭션 객체로 남겨 지급과 함께 커밋된다.
    expect(fixture.audit.logAdmin).toHaveBeenCalledTimes(1);
    expect(fixture.audit.logAdmin).toHaveBeenCalledWith(
      {
        action: 'admin.settlement.paid',
        actorId: 'admin-1',
        targetType: 'settlement',
        targetId: 'settlement-1',
        before: { status: 'confirmed' },
        after: { status: 'paid' },
      },
      expect.objectContaining({ update: expect.any(Function) }),
    );
  });

  it('동시 지급 race에서는 fresh status를 기준으로 confirmed→paid 성공이 한 번뿐이다', async () => {
    const fixture = makeMarkAsPaidFixture('confirmed');

    const results = await Promise.allSettled([
      fixture.service.markAsPaid('settlement-1', 'admin-1'),
      fixture.service.markAsPaid('settlement-1', 'admin-1'),
    ]);
    const successes = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toBeInstanceOf(BadRequestException);
    expect(failures[0].reason.message).toBe(
      '이미 지급 완료된 정산입니다.',
    );
    expect(fixture.transactionReads).toEqual([
      SETTLEMENT_PATH,
      REVERSAL_QUERY_READ,
      SETTLEMENT_PATH,
    ]);
    expect(fixture.transactionUpdates).toHaveLength(1);
    expect(fixture.records.get(SETTLEMENT_PATH)).toMatchObject({ status: 'paid' });
  });

  function reversalIssue(status: string, overrides: Data = {}): Data {
    return {
      id: `issue-${status}`,
      orderId: 'order-1',
      type: 'PROVIDER_REVERSAL_DETECTED',
      status,
      severity: 'critical',
      ...overrides,
    };
  }

  it('결제사 취소·분쟁 기록이 OPEN이면 409로 거부하고 transaction write를 만들지 않는다', async () => {
    const fixture = makeMarkAsPaidFixture('confirmed', [reversalIssue('OPEN')]);

    const error = await fixture.service.markAsPaid('settlement-1', 'admin-1').catch((reason) => reason);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getStatus()).toBe(409);
    expect(error.message).toBe(
      '결제사 취소·분쟁 확인이 끝나지 않은 주문입니다. 운영 확인 기록을 먼저 처리한 뒤 지급하세요.',
    );
    expect(fixture.transactionReads).toEqual([SETTLEMENT_PATH, REVERSAL_QUERY_READ]);
    expect(fixture.transactionUpdates).toHaveLength(0);
    expect(fixture.records.get(SETTLEMENT_PATH)).toMatchObject({ status: 'confirmed' });
  });

  it.each([
    ['RESOLVED 기록', [reversalIssue('RESOLVED')]],
    ['DISMISSED 기록', [reversalIssue('DISMISSED')]],
    ['다른 주문의 OPEN 기록', [reversalIssue('OPEN', { orderId: 'order-2' })]],
    ['다른 유형의 OPEN 기록', [reversalIssue('OPEN', { type: 'PAYMENT_LOOKUP_FAILED' })]],
    ['기록 없음', []],
  ] as const)('%s은 지급을 막지 않는다', async (_label, issues) => {
    const fixture = makeMarkAsPaidFixture('confirmed', [...issues]);

    await expect(fixture.service.markAsPaid('settlement-1', 'admin-1')).resolves.toEqual({
      settlementId: 'settlement-1',
      status: 'paid',
    });
    expect(fixture.transactionUpdates).toHaveLength(1);
  });
});
