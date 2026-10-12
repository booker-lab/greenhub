import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { FirestoreService } from '../firestore/firestore.service';
import { StorageService } from '../firestore/storage.service';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import { RetentionService } from './retention.service';
import { RetentionAdminController } from './retention-admin.controller';

type Data = Record<string, any>;
type Role = 'consumer' | 'seller' | 'driver' | 'admin';

const JWT_SECRET = 'retention-legal-hold-test-secret';
const NOW = new Date('2026-07-17T01:00:00.000Z');

function timestamp(iso: string) {
  const date = new Date(iso);
  return { toDate: () => date, toMillis: () => date.getTime() };
}

interface FakeQuery {
  kind: 'query';
  name: string;
  filters: Array<[string, string, unknown]>;
  where(field: string, op: string, value: unknown): FakeQuery;
  get(): Promise<{ docs: Data[]; empty: boolean; size: number }>;
}

function makeFirestore(initial: Record<string, Data>) {
  const records = new Map<string, Data>(Object.entries(initial));

  const doc = (path: string) => ({
    path,
    get: jest.fn(async () => ({ exists: records.has(path), data: () => records.get(path) })),
  });

  const runQuery = (query: FakeQuery) => {
    const docs = Array.from(records.entries())
      .filter(([path]) => path.startsWith(`${query.name}/`))
      .filter(([, data]) =>
        query.filters.every(([field, op, value]) => {
          if (op === '<=') {
            const actual = data[field] as { toMillis?: () => number } | undefined;
            const expected = value as { toMillis?: () => number };
            return (
              (actual?.toMillis?.() ?? Number.POSITIVE_INFINITY) <=
              (expected?.toMillis?.() ?? Number.NEGATIVE_INFINITY)
            );
          }
          return data[field] === value;
        }),
      )
      .map(([path, data]) => ({ id: path.split('/')[1], data: () => data, ref: { path } }));
    return { docs, empty: docs.length === 0, size: docs.length };
  };

  const collection = (name: string): FakeQuery => {
    const query: FakeQuery = {
      kind: 'query',
      name,
      filters: [],
      where(field, op, value) {
        query.filters.push([field, op, value]);
        return query;
      },
      async get() {
        return runQuery(query);
      },
    };
    return query;
  };

  const updates: Array<{ path: string; data: Data }> = [];
  const firestore = {
    doc: jest.fn(doc),
    collection: jest.fn(collection),
    batch: jest.fn(() => {
      const pending: string[] = [];
      const handle = {
        delete: jest.fn((ref: { path: string }) => {
          pending.push(ref.path);
          return handle;
        }),
        commit: jest.fn(async () => {
          for (const path of pending) records.delete(path);
        }),
      };
      return handle;
    }),
    runTransaction: jest.fn(async (callback: (tx: Data) => Promise<unknown>) =>
      callback({
        get: async (target: { kind?: string; path?: string }) =>
          target.kind === 'query' ? runQuery(target as FakeQuery) : doc(String(target.path)).get(),
        update: (ref: { path: string }, data: Data) => {
          if (!records.has(ref.path)) throw new Error(`missing ${ref.path}`);
          updates.push({ path: ref.path, data });
          records.set(ref.path, { ...records.get(ref.path), ...data });
        },
      }),
    ),
    Timestamp: {
      now: jest.fn(() => timestamp(NOW.toISOString())),
      fromDate: jest.fn((date: Date) => timestamp(date.toISOString())),
    },
  };
  return { firestore, records, updates };
}

function seed(): Record<string, Data> {
  const expired = timestamp('2026-07-16T01:00:00.000Z');
  return {
    'users/admin-1': { role: 'admin', storeId: null },
    'users/consumer-1': { role: 'consumer', storeId: null },
    'users/seller-1': { role: 'seller', storeId: 'store-1' },
    'users/driver-1': { role: 'driver', storeId: null, driverApproved: true },
    'orders/order-1': { storeId: 'store-1', status: 'DELIVERED' },
    'orders/order-2': { storeId: 'store-1', status: 'DELIVERED' },
    'deliveryPhotoRecords/order-1:photo-1': {
      orderId: 'order-1',
      storeId: 'store-1',
      expiresAt: expired,
      storagePath: 'deliveryPhotos/order-1/photo-1.jpg',
    },
    'legalOrderRecords/order-1:contract': {
      orderId: 'order-1',
      expiresAt: timestamp('2031-07-16T01:00:00.000Z'),
    },
    'legalDisputeRecords/payment-1:refund': {
      orderId: 'order-1',
      expiresAt: timestamp('2029-07-16T01:00:00.000Z'),
    },
    'marketingConsentLogs/consent-1': {
      orderId: 'order-1',
      expiresAt: timestamp('2029-07-16T01:00:00.000Z'),
    },
    'deliveryPhotoRecords/order-2:photo-2': {
      orderId: 'order-2',
      storeId: 'store-1',
      expiresAt: expired,
      storagePath: 'deliveryPhotos/order-2/photo-2.jpg',
    },
  };
}

describe('주문 단위 보관 기록 보존 보류', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let harness: ReturnType<typeof makeFirestore>;
  let storage: { deleteObject: jest.Mock };
  let retention: RetentionService;

  beforeEach(async () => {
    harness = makeFirestore(seed());
    storage = { deleteObject: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: JWT_SECRET })],
      controllers: [RetentionAdminController],
      providers: [
        RetentionService,
        { provide: FirestoreService, useValue: harness.firestore },
        { provide: StorageService, useValue: storage },
        { provide: OperationIssueWriterService, useValue: { createOrMergeIssue: jest.fn() } },
        { provide: ConfigService, useValue: new ConfigService({ JWT_SECRET }) },
        JwtAuthGuard,
        RolesGuard,
        JwtStrategy,
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(sanitizedValidationPipeOptions()));
    jwt = app.get(JwtService);
    retention = app.get(RetentionService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function tokenFor(role: Role) {
    return jwt.sign({
      sub: `${role}-1`,
      role,
      storeId: role === 'seller' ? 'store-1' : null,
      typ: 'access',
    });
  }

  function putHold(orderId: string, body: unknown, role: Role | null = 'admin') {
    const test = request(app.getHttpServer())
      .put(`/admin/retention/orders/${orderId}/legal-hold`)
      .send(body as object);
    return role ? test.set('Authorization', `Bearer ${tokenFor(role)}`) : test;
  }

  it('컨트롤러는 JWT·역할 가드와 관리자 역할만 메타데이터로 선언한다', () => {
    const reflector = new Reflector();
    expect(reflector.get(ROLES_KEY, RetentionAdminController)).toEqual(['admin']);
    expect(Reflect.getMetadata('__guards__', RetentionAdminController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
  });

  it('인증되지 않은 요청은 401, 관리자가 아닌 역할은 403으로 거부하고 기록을 바꾸지 않는다', async () => {
    await putHold('order-1', { hold: true, reason: '분쟁 접수' }, null).expect(401);
    for (const role of ['consumer', 'seller', 'driver'] as const) {
      await putHold('order-1', { hold: true, reason: '분쟁 접수' }, role).expect(403);
    }
    expect(harness.updates).toHaveLength(0);
  });

  it('보류 설정은 주문에 연결된 사진·주문·분쟁 기록에 보류 여부·사유·설정자·시각을 남긴다', async () => {
    const response = await putHold('order-1', { hold: true, reason: '  배송 분쟁 접수  ' }).expect(
      200,
    );

    expect(response.body).toEqual({
      orderId: 'order-1',
      legalHold: true,
      updatedCount: 3,
      updatedByPurpose: {
        deliveryPhotoRecords: 1,
        legalOrderRecords: 1,
        legalDisputeRecords: 1,
      },
    });
    for (const path of [
      'deliveryPhotoRecords/order-1:photo-1',
      'legalOrderRecords/order-1:contract',
      'legalDisputeRecords/payment-1:refund',
    ]) {
      expect(harness.records.get(path)).toMatchObject({
        legalHold: true,
        legalHoldReason: '배송 분쟁 접수',
        legalHoldUpdatedBy: 'admin-1',
      });
      expect(harness.records.get(path)?.legalHoldUpdatedAt.toDate()).toEqual(NOW);
    }
    // 마케팅 동의 기록과 다른 주문의 기록은 바꾸지 않는다.
    expect(harness.records.get('marketingConsentLogs/consent-1')).not.toHaveProperty('legalHold');
    expect(harness.records.get('deliveryPhotoRecords/order-2:photo-2')).not.toHaveProperty(
      'legalHold',
    );
  });

  it('보류를 설정한 만료 기록은 파기에서 건너뛰고, 해제하면 다시 파기 대상이 된다', async () => {
    await putHold('order-1', { hold: true, reason: '배송 분쟁 접수' }).expect(200);

    await retention.purgeExpiredRecords({ now: NOW });
    expect(harness.records.has('deliveryPhotoRecords/order-1:photo-1')).toBe(true);
    expect(harness.records.has('deliveryPhotoRecords/order-2:photo-2')).toBe(false);
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).toHaveBeenCalledWith('deliveryPhotos/order-2/photo-2.jpg');

    await putHold('order-1', { hold: false, reason: '분쟁 종료' }).expect(200);
    expect(harness.records.get('deliveryPhotoRecords/order-1:photo-1')).toMatchObject({
      legalHold: false,
      legalHoldReason: '분쟁 종료',
      legalHoldUpdatedBy: 'admin-1',
    });

    await retention.purgeExpiredRecords({ now: NOW });
    expect(harness.records.has('deliveryPhotoRecords/order-1:photo-1')).toBe(false);
    expect(storage.deleteObject).toHaveBeenCalledWith('deliveryPhotos/order-1/photo-1.jpg');
  });

  it('존재하지 않는 주문은 404로 거부한다', async () => {
    await putHold('order-missing', { hold: true, reason: '분쟁 접수' }).expect(404);
    expect(harness.updates).toHaveLength(0);
  });

  it.each([
    ['hold 누락', { reason: '분쟁 접수' }],
    ['hold 문자열', { hold: 'true', reason: '분쟁 접수' }],
    ['reason 누락', { hold: true }],
    ['reason 빈 문자열', { hold: true, reason: '' }],
    ['reason 공백만', { hold: true, reason: '   ' }],
    ['reason 200자 초과', { hold: true, reason: '가'.repeat(201) }],
    ['허용되지 않은 필드', { hold: true, reason: '분쟁 접수', extra: 'x' }],
  ])('잘못된 body(%s)는 400으로 거부한다', async (_label, body) => {
    await putHold('order-1', body).expect(400);
    expect(harness.updates).toHaveLength(0);
  });

  it('reason 200자는 허용한다', async () => {
    await putHold('order-1', { hold: true, reason: '가'.repeat(200) }).expect(200);
  });

  it('주문 식별자 형식이 올바르지 않으면 400으로 거부한다', async () => {
    await expect(
      retention.setOrderLegalHold({
        orderId: '../users/admin-1',
        hold: true,
        reason: '분쟁 접수',
        actorId: 'admin-1',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(harness.firestore.runTransaction).not.toHaveBeenCalled();
  });
});
