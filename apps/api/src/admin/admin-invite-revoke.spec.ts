// 초대 토큰 취소(F2·T4)와 취소 토큰 가입 거부(C8)를 실제 HTTP 경로로 증명한다.
//
// AdminController·AuthController를 실제 AdminService·AuthService·JwtAuthGuard·RolesGuard와 묶고,
// 두 서비스가 같은 OCC Firestore 가짜(트랜잭션 충돌·재시도 모델)를 공유하게 한다.
// 그래서 "관리자가 취소 → 같은 토큰으로 판매자 가입" 흐름이 운영과 같은 문서·트랜잭션 경로를 지난다.
// 운영 Firestore는 Date로 쓴 값을 Timestamp로 돌려주므로, 읽기 결과의 Date를 Timestamp로 바꿔 넘긴다.

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { Timestamp } from 'firebase-admin/firestore';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { KakaoClient } from '../auth/kakao.client';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { AuditService } from '../common/audit/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TimestampInterceptor } from '../common/interceptors/timestamp.interceptor';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { FirestoreService } from '../firestore/firestore.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

type Occ = ReturnType<typeof createOccFirestore>;
type Data = Record<string, unknown>;
type Actor = 'admin' | 'consumer' | 'seller' | 'driver';

const JWT_SECRET = 'admin-invite-revoke-test-secret';
const DAY_MS = 24 * 60 * 60 * 1000;

function toFirestoreRead(value: unknown): unknown {
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (Array.isArray(value)) return value.map(toFirestoreRead);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Data).map(([key, item]) => [key, toFirestoreRead(item)]),
    );
  }
  return value;
}

// OCC 가짜 위에 "읽기는 Timestamp" 규칙만 덧씌운다. 쓰기·버전·충돌 판정은 가짜 그대로다.
function withTimestampReads(occ: Occ) {
  const fs = occ.firestore;
  const wrapSnapshot = (snapshot: any) => ({
    ...snapshot,
    data: () => toFirestoreRead(snapshot.data()),
  });
  const wrapRef = (ref: any) => ({
    ...ref,
    get: async () => wrapSnapshot(await ref.get()),
  });
  const wrapQuery = (query: any): any => ({
    where: (...args: unknown[]) => wrapQuery(query.where(...args)),
    orderBy: (...args: unknown[]) => wrapQuery(query.orderBy(...args)),
    limit: (value: number) => wrapQuery(query.limit(value)),
    get: async () => {
      const snapshot = await query.get();
      return { ...snapshot, docs: snapshot.docs.map(wrapSnapshot) };
    },
  });
  return {
    ...fs,
    doc: (path: string) => wrapRef(fs.doc(path)),
    collection: (path: string) => wrapQuery(fs.collection(path)),
    runTransaction: <T>(callback: (tx: any) => Promise<T>) =>
      fs.runTransaction((tx) =>
        callback({
          ...tx,
          get: async (target: unknown) => wrapSnapshot(await tx.get(target as never)),
        }),
      ),
  };
}

function seedUsers(occ: Occ) {
  occ.seed('users/admin-1', { id: 'admin-1', role: 'admin', storeId: null });
  occ.seed('users/consumer-1', { id: 'consumer-1', role: 'consumer', storeId: null });
  occ.seed('users/seller-1', { id: 'seller-1', role: 'seller', storeId: 'store-1' });
  occ.seed('users/driver-1', {
    id: 'driver-1',
    role: 'driver',
    storeId: null,
    driverApproved: true,
  });
}

function seedInvite(occ: Occ, token: string, overrides: Data = {}) {
  occ.seed(`invites/${token}`, {
    token,
    createdBy: 'admin-1',
    usedAt: null,
    usedBy: null,
    expiresAt: new Date(Date.now() + 7 * DAY_MS),
    createdAt: new Date(),
    ...overrides,
  });
}

describe('관리자 초대 토큰 취소(POST /admin/invite/:token/revoke)와 가입 거부', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let occ: Occ;
  let adminService: AdminService;

  beforeEach(async () => {
    occ = createOccFirestore();
    seedUsers(occ);
    const firestore = withTimestampReads(occ);

    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: JWT_SECRET })],
      controllers: [AdminController, AuthController],
      providers: [
        AdminService,
        AuthService,
        { provide: FirestoreService, useValue: firestore },
        { provide: ConfigService, useValue: new ConfigService({ JWT_SECRET }) },
        { provide: KakaoClient, useValue: {} },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        JwtAuthGuard,
        RolesGuard,
        JwtStrategy,
      ],
    })
      .useMocker(() => ({}))
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(sanitizedValidationPipeOptions()));
    app.useGlobalInterceptors(new TimestampInterceptor());
    jwt = app.get(JwtService);
    adminService = app.get(AdminService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function bearer(actor: Actor) {
    const token = jwt.sign({
      sub: `${actor}-1`,
      role: actor,
      storeId: actor === 'seller' ? 'store-1' : null,
    });
    return `Bearer ${token}`;
  }

  function revoke(token: string, actor: Actor | 'unauthenticated' = 'admin') {
    const test = request(app.getHttpServer()).post(`/admin/invite/${token}/revoke`);
    return actor === 'unauthenticated' ? test : test.set('Authorization', bearer(actor));
  }

  function registerSeller(inviteToken: string, email = 'new-seller@example.com') {
    return request(app.getHttpServer()).post('/auth/register').send({
      email,
      password: 'password1234',
      name: '새 판매자',
      role: 'seller',
      inviteToken,
    });
  }

  function sellerUsers() {
    return occ.listData('users/').filter((user) => user['email'] === 'new-seller@example.com');
  }

  it('관리자가 발급한 유효 토큰을 취소하면 흔적이 남고, 그 토큰으로는 판매자 가입이 409로 막힌다', async () => {
    const issued = await request(app.getHttpServer())
      .post('/admin/invite')
      .set('Authorization', bearer('admin'))
      .expect(201);
    const token = issued.body.token as string;

    const revoked = await revoke(token).expect(201);
    expect(revoked.body).toEqual({ token, revokedAt: expect.any(String) });

    const stored = occ.getData(`invites/${token}`);
    expect(stored).toMatchObject({ revokedBy: 'admin-1', usedAt: null, usedBy: null });
    expect(stored?.['revokedAt']).toBeInstanceOf(Date);

    const list = await request(app.getHttpServer())
      .get('/admin/invite')
      .set('Authorization', bearer('admin'))
      .expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({ token, revokedAt: revoked.body.revokedAt, revokedBy: 'admin-1' }),
    ]);

    const rejected = await registerSeller(token).expect(409);
    expect(rejected.body).toMatchObject({ statusCode: 409, reason: 'already_revoked' });
    expect(sellerUsers()).toHaveLength(0);
    expect(occ.getData(`invites/${token}`)).toMatchObject({ usedAt: null, usedBy: null });
  });

  it('취소 뒤 만료까지 지난 토큰도 가입 시 만료(410)가 아니라 409 already_revoked로 거부한다', async () => {
    seedInvite(occ, 'REVOKEDTOKEN0001', {
      expiresAt: new Date(Date.now() - DAY_MS),
      revokedAt: new Date(Date.now() - 2 * DAY_MS),
      revokedBy: 'admin-1',
    });

    const response = await registerSeller('REVOKEDTOKEN0001').expect(409);

    expect(response.body).toMatchObject({ statusCode: 409, reason: 'already_revoked' });
    expect(sellerUsers()).toHaveLength(0);
  });

  it.each([
    'consumer',
    'seller',
    'driver',
  ] as const)('%s 계정의 취소 요청은 403이고 토큰 문서는 그대로다', async (actor) => {
    seedInvite(occ, 'VALIDTOKEN000001');
    const before = occ.getVersion('invites/VALIDTOKEN000001');

    await revoke('VALIDTOKEN000001', actor).expect(403);

    expect(occ.getVersion('invites/VALIDTOKEN000001')).toBe(before);
    expect(occ.getData('invites/VALIDTOKEN000001')).not.toHaveProperty('revokedAt');
  });

  it('인증 없는 취소 요청은 401이다', async () => {
    seedInvite(occ, 'VALIDTOKEN000001');

    await revoke('VALIDTOKEN000001', 'unauthenticated').expect(401);

    expect(occ.getData('invites/VALIDTOKEN000001')).not.toHaveProperty('revokedAt');
  });

  it('이미 가입에 쓰인 토큰은 취소할 수 없다(409 already_used)', async () => {
    seedInvite(occ, 'USEDTOKEN0000001');
    await registerSeller('USEDTOKEN0000001').expect(201);
    const before = occ.getVersion('invites/USEDTOKEN0000001');

    const response = await revoke('USEDTOKEN0000001').expect(409);

    expect(response.body).toMatchObject({ statusCode: 409, reason: 'already_used' });
    expect(occ.getVersion('invites/USEDTOKEN0000001')).toBe(before);
    expect(occ.getData('invites/USEDTOKEN0000001')).not.toHaveProperty('revokedAt');
  });

  it('이미 취소된 토큰을 다시 취소하면 409 already_revoked이고 처음 기록은 바뀌지 않는다', async () => {
    seedInvite(occ, 'VALIDTOKEN000001');
    await revoke('VALIDTOKEN000001').expect(201);
    const first = occ.getData('invites/VALIDTOKEN000001');

    const response = await revoke('VALIDTOKEN000001').expect(409);

    expect(response.body).toMatchObject({ statusCode: 409, reason: 'already_revoked' });
    expect(occ.getData('invites/VALIDTOKEN000001')).toEqual(first);
  });

  it('만료된 토큰은 취소할 수 없다(409 expired)', async () => {
    seedInvite(occ, 'EXPIREDTOKEN0001', { expiresAt: new Date(Date.now() - DAY_MS) });

    const response = await revoke('EXPIREDTOKEN0001').expect(409);

    expect(response.body).toMatchObject({ statusCode: 409, reason: 'expired' });
    expect(occ.getData('invites/EXPIREDTOKEN0001')).not.toHaveProperty('revokedAt');
  });

  it('없는 토큰이나 경로 문자가 섞인 토큰은 404다', async () => {
    await revoke('NOSUCHTOKEN00001').expect(404);
    await revoke('A%2FB').expect(404);

    expect(occ.listData('invites/')).toHaveLength(0);
  });

  it('가입 사전 검사 뒤 취소가 먼저 커밋되면 가입 트랜잭션이 409 already_revoked로 거부한다', async () => {
    seedInvite(occ, 'RACETOKEN0000001');
    occ.setBeforeAttempt(async () => {
      await adminService.revokeInvite('RACETOKEN0000001', 'admin-1');
    });

    const response = await registerSeller('RACETOKEN0000001').expect(409);

    expect(response.body).toMatchObject({ statusCode: 409, reason: 'already_revoked' });
    expect(sellerUsers()).toHaveLength(0);
    expect(occ.getData('invites/RACETOKEN0000001')).toMatchObject({
      usedAt: null,
      revokedBy: 'admin-1',
    });
  });

  it('취소와 가입이 동시에 와도 둘 중 하나만 성공한다', async () => {
    seedInvite(occ, 'RACETOKEN0000002');

    const [revoked, registered] = await Promise.all([
      revoke('RACETOKEN0000002'),
      registerSeller('RACETOKEN0000002'),
    ]);

    const stored = occ.getData('invites/RACETOKEN0000002') as Data;
    if (revoked.status === 201) {
      expect(registered.status).toBe(409);
      expect(registered.body).toMatchObject({ reason: 'already_revoked' });
      expect(stored['usedAt']).toBeNull();
      expect(sellerUsers()).toHaveLength(0);
    } else {
      expect(revoked.status).toBe(409);
      expect(revoked.body).toMatchObject({ reason: 'already_used' });
      expect(registered.status).toBe(201);
      expect(stored).not.toHaveProperty('revokedAt');
      expect(sellerUsers()).toHaveLength(1);
    }
  });
});
