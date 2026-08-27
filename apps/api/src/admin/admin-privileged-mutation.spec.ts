import { BadRequestException, type INestApplication, ValidationPipe } from '@nestjs/common';
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
type MutationName = 'refund' | 'pay' | 'approveDriver' | 'suspendDriver';

const JWT_SECRET = 'admin-privileged-mutation-test-secret';
const SETTLEMENT_PATH = 'settlements/settlement-1';

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
  };

  return { adminService, firestore, firestoreWrites, payments, serviceBoundary, settlements, users };
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
    }
  }

  function callMutation(name: MutationName, actor: Actor | 'admin') {
    const test = mutationRequest(name);
    if (actor === 'unauthenticated') return test;
    return test.set('Authorization', `Bearer ${tokenFor(actor)}`);
  }

  function successStatus(name: MutationName) {
    return name === 'refund' ? 201 : 200;
  }

  const mutations: MutationName[] = ['refund', 'pay', 'approveDriver', 'suspendDriver'];

  it.each(mutations)('%s는 인증되지 않은 요청을 401로 거부한다', async (name) => {
    await callMutation(name, 'unauthenticated').expect(401);

    expect(harness.serviceBoundary.forceRefund).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.markAsPaid).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.approveDriver).not.toHaveBeenCalled();
    expect(harness.serviceBoundary.suspendDriver).not.toHaveBeenCalled();
    expect(harness.payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(harness.settlements.cancelSettlement).not.toHaveBeenCalled();
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
    expect(harness.payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(harness.settlements.cancelSettlement).not.toHaveBeenCalled();
    expect(harness.firestoreWrites.update).not.toHaveBeenCalled();
    expect(harness.firestoreWrites.set).not.toHaveBeenCalled();
    expect(harness.firestoreWrites.runTransaction).not.toHaveBeenCalled();
  });

  it.each(mutations)('current admin의 %s 요청은 controller service boundary에 도달한다', async (name) => {
    await callMutation(name, 'admin').expect(successStatus(name));

    switch (name) {
      case 'refund':
        expect(harness.serviceBoundary.forceRefund).toHaveBeenCalledWith('order-1', {
          reason: '검증 환불',
        });
        break;
      case 'pay':
        expect(harness.serviceBoundary.markAsPaid).toHaveBeenCalledWith('settlement-1');
        break;
      case 'approveDriver':
        expect(harness.serviceBoundary.approveDriver).toHaveBeenCalledWith('driver-1');
        break;
      case 'suspendDriver':
        expect(harness.serviceBoundary.suspendDriver).toHaveBeenCalledWith('driver-1', {
          suspended: true,
        });
        break;
    }
  });
});

function makeMarkAsPaidFixture(status?: string) {
  const records = new Map<string, Data>();
  if (status !== undefined) records.set(SETTLEMENT_PATH, { id: 'settlement-1', status });

  const refs = new Map<string, Data>();
  const transactionReads: string[] = [];
  const transactionUpdates: Array<{ path: string; data: Data }> = [];
  let transactionTail = Promise.resolve();

  const doc = jest.fn((path: string) => {
    if (!refs.has(path)) refs.set(path, { path });
    return refs.get(path);
  });

  const runTransaction = jest.fn().mockImplementation((callback: (tx: Data) => Promise<unknown>) => {
    const execute = transactionTail.then(async () => {
      const pending = new Map<string, Data>();
      const tx = {
        get: jest.fn(async (ref: Data) => {
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
    runTransaction,
    Timestamp: { now: jest.fn(() => 'transaction-now') },
  };
  const service = new AdminService(
    firestore as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { records, refs, runTransaction, service, transactionReads, transactionUpdates };
}

describe('AdminService.markAsPaid 상태 계약', () => {
  it.each([
    ['missing', undefined, '정산 내역을 찾을 수 없습니다.'],
    ['pending', 'pending', 'confirmed 상태의 정산만 지급 처리할 수 있습니다.'],
    ['cancelled', 'cancelled', 'confirmed 상태의 정산만 지급 처리할 수 있습니다.'],
    ['already paid', 'paid', '이미 지급 완료된 정산입니다.'],
  ] as const)('%s는 DENY하고 transaction write를 만들지 않는다', async (_label, status, message) => {
    const fixture = makeMarkAsPaidFixture(status);

    await expect(fixture.service.markAsPaid('settlement-1')).rejects.toThrow(message);

    expect(fixture.transactionReads).toEqual([SETTLEMENT_PATH]);
    expect(fixture.transactionUpdates).toHaveLength(0);
  });

  it('confirmed는 transaction fresh read 후 paid로 전이하고 paidAt·updatedAt을 설정한다', async () => {
    const fixture = makeMarkAsPaidFixture('confirmed');

    await expect(fixture.service.markAsPaid('settlement-1')).resolves.toEqual({
      settlementId: 'settlement-1',
      status: 'paid',
    });

    expect(fixture.transactionReads).toEqual([SETTLEMENT_PATH]);
    expect(fixture.transactionUpdates).toEqual([
      {
        path: SETTLEMENT_PATH,
        data: {
          status: 'paid',
          paidAt: 'transaction-now',
          updatedAt: 'transaction-now',
        },
      },
    ]);
    expect(fixture.records.get(SETTLEMENT_PATH)).toMatchObject({
      status: 'paid',
      paidAt: 'transaction-now',
      updatedAt: 'transaction-now',
    });
  });

  it('동시 지급 race에서는 fresh status를 기준으로 confirmed→paid 성공이 한 번뿐이다', async () => {
    const fixture = makeMarkAsPaidFixture('confirmed');

    const results = await Promise.allSettled([
      fixture.service.markAsPaid('settlement-1'),
      fixture.service.markAsPaid('settlement-1'),
    ]);
    const successes = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect((failures[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
    expect((failures[0] as PromiseRejectedResult).reason.message).toBe(
      '이미 지급 완료된 정산입니다.',
    );
    expect(fixture.transactionReads).toEqual([SETTLEMENT_PATH, SETTLEMENT_PATH]);
    expect(fixture.transactionUpdates).toHaveLength(1);
    expect(fixture.records.get(SETTLEMENT_PATH)).toMatchObject({ status: 'paid' });
  });
});
