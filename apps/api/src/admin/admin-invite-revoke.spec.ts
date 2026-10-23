// 초대 토큰 취소(F2·T4)와 취소 토큰 가입 거부(C8)를 실제 HTTP 경로로 증명한다.
//
// 카카오 초대 가입(POST /auth/kakao-login + inviteToken)도 같은 초대 문서·트랜잭션 경로로 증명한다.
//
// AdminController·AuthController를 실제 AdminService·AuthService·JwtAuthGuard·RolesGuard와 묶고,
// 두 서비스가 같은 OCC Firestore 가짜(트랜잭션 충돌·재시도 모델)를 공유하게 한다.
// 그래서 "관리자가 취소 → 같은 토큰으로 판매자 가입" 흐름이 운영과 같은 문서·트랜잭션 경로를 지난다.
// 운영 Firestore는 Date로 쓴 값을 Timestamp로 돌려주므로, 읽기 결과의 Date를 Timestamp로 바꿔 넘긴다.

import { type INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
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
import { KakaoClient, type KakaoProfile } from '../auth/kakao.client';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { AuditService } from '../common/audit/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TimestampInterceptor } from '../common/interceptors/timestamp.interceptor';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { FirestoreService } from '../firestore/firestore.service';
import { AdminController } from './admin.controller';
import { AdminService, INVITE_TTL_MS } from './admin.service';

type Occ = ReturnType<typeof createOccFirestore>;
type Data = Record<string, unknown>;
type Actor = 'admin' | 'consumer' | 'seller' | 'driver';

const JWT_SECRET = 'admin-invite-revoke-test-secret';
const JWT_REFRESH_SECRET = 'admin-invite-revoke-test-refresh-secret';
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
          // 공용 OCC 가짜에는 create가 없다. 가입은 이메일 연결 문서를 먼저 tx.get으로 읽어
          // 없음을 확인한 뒤 create하므로, 읽기 버전이 남은 set으로 옮겨도 동시 생성은 커밋 충돌로 드러난다.
          create: (ref: unknown, data: Data) => tx.set(ref as never, data),
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
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    createdAt: new Date(),
    ...overrides,
  });
}

describe('관리자 초대 토큰 취소(POST /admin/invite/:token/revoke)와 가입 거부', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let occ: Occ;
  let adminService: AdminService;
  // 카카오 access token별로 돌려줄 검증된 프로필. 테스트마다 채운다.
  let kakaoProfiles: Record<string, KakaoProfile>;

  beforeEach(async () => {
    kakaoProfiles = {};
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
        { provide: ConfigService, useValue: new ConfigService({ JWT_SECRET, JWT_REFRESH_SECRET }) },
        {
          provide: KakaoClient,
          useValue: {
            getUser: async (accessToken: string) => {
              const profile = kakaoProfiles[accessToken];
              if (!profile) throw new UnauthorizedException('카카오 사용자 정보를 확인할 수 없습니다.');
              return profile;
            },
          },
        },
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
      .send({ recipientEmail: 'new-seller@example.com' })
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
    expect(list.body).toEqual({
      invites: [
        expect.objectContaining({ token, revokedAt: revoked.body.revokedAt, revokedBy: 'admin-1' }),
      ],
      hasMore: false,
      limit: 50,
    });

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

  it.each([
    'A/B',
    'invites/OTHER',
    '../VALIDTOKEN000001',
    'BAD-TOKEN',
    'TOKEN 0001',
    'A'.repeat(65),
  ])('형식이 틀린 초대 토큰 %p의 판매자 가입은 취소 경로와 같은 404이고 아무 문서도 만들지 않는다', async (token) => {
    seedInvite(occ, 'VALIDTOKEN000001');

    const response = await registerSeller(token).expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: '초대 토큰을 찾을 수 없습니다.',
    });
    expect(sellerUsers()).toHaveLength(0);
    expect(occ.listData('emailIdentities/')).toHaveLength(0);
    expect(occ.getData('invites/VALIDTOKEN000001')).toMatchObject({ usedAt: null, usedBy: null });
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

  describe('받는 사람 이메일 필수 발급과 가입 트랜잭션의 만료 재검증', () => {
    function issue(body?: Data) {
      const test = request(app.getHttpServer())
        .post('/admin/invite')
        .set('Authorization', bearer('admin'));
      return body === undefined ? test : test.send(body);
    }

    function usersWithEmail(email: string) {
      return occ.listData('users/').filter((user) => user['email'] === email);
    }

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('받는 사람 이메일을 주면 201이고 72시간 뒤 만료되며, 그 값을 그대로 저장한다', async () => {
      const seventyTwoHoursMs = 72 * 60 * 60 * 1000;
      expect(INVITE_TTL_MS).toBe(seventyTwoHoursMs);
      const before = Date.now();
      const issued = await issue({ recipientEmail: 'new-seller@example.com' }).expect(201);
      const token = issued.body.token as string;

      expect(issued.body).toEqual({
        token,
        expiresAt: expect.any(String),
        recipientEmail: 'new-seller@example.com',
      });
      const expiresAtMs = Date.parse(issued.body.expiresAt as string);
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + seventyTwoHoursMs);
      expect(expiresAtMs).toBeLessThanOrEqual(Date.now() + seventyTwoHoursMs);
      expect(occ.listData('invites/')).toHaveLength(1);
      expect(occ.getData(`invites/${token}`)).toMatchObject({
        token,
        createdBy: 'admin-1',
        usedAt: null,
        usedBy: null,
        recipientEmail: 'new-seller@example.com',
      });
    });

    it.each([
      ['본문 없음', undefined],
      ['빈 본문', {}],
      ['recipientEmail: null', { recipientEmail: null }],
      ['빈 문자열', { recipientEmail: '' }],
      ['공백뿐인 문자열', { recipientEmail: '   ' }],
    ] as const)('받는 사람 이메일이 없으면(%s) 400이고 초대 문서를 만들지 않는다', async (_label, body) => {
      const response = await issue(body === undefined ? undefined : { ...body }).expect(400);

      expect(response.body).toMatchObject({ statusCode: 400 });
      expect(occ.listData('invites/')).toHaveLength(0);
    });

    it.each([
      ['recipientEmail이 null로 저장된', { recipientEmail: null }],
      ['recipientEmail 필드가 없는', {}],
    ] as const)('필수화 전에 %s 기존 초대는 만료 전까지 어떤 이메일로든 가입할 수 있다', async (_label, overrides) => {
      seedInvite(occ, 'LEGACYTOKEN00001', { ...overrides });

      await registerSeller('LEGACYTOKEN00001', 'anyone@example.com').expect(201);

      expect(usersWithEmail('anyone@example.com')).toHaveLength(1);
      expect(occ.getData('invites/LEGACYTOKEN00001')).toMatchObject({
        usedAt: expect.any(Date),
        usedBy: usersWithEmail('anyone@example.com')[0]?.['id'],
      });
    });

    it('받는 사람 값이 문자열이 아닌 저장 초대는 제한 없음으로 보지 않고 409 recipient_mismatch로 거부한다', async () => {
      seedInvite(occ, 'MALFORMEDTOKEN01', { recipientEmail: 123 });

      const rejected = await registerSeller('MALFORMEDTOKEN01', 'anyone@example.com').expect(409);

      expect(rejected.body).toMatchObject({ statusCode: 409, reason: 'recipient_mismatch' });
      expect(usersWithEmail('anyone@example.com')).toHaveLength(0);
      expect(occ.getData('invites/MALFORMEDTOKEN01')).toMatchObject({ usedAt: null, usedBy: null });
    });

    it('받는 사람 이메일을 지정하면 정규화해 저장하고, 대소문자만 다른 같은 이메일의 가입은 받는다', async () => {
      const issued = await issue({ recipientEmail: 'New-Seller@Example.COM' }).expect(201);
      const token = issued.body.token as string;

      expect(issued.body).toMatchObject({ token, recipientEmail: 'new-seller@example.com' });
      expect(occ.getData(`invites/${token}`)).toMatchObject({
        recipientEmail: 'new-seller@example.com',
      });

      await registerSeller(token, 'NEW-seller@example.com').expect(201);

      expect(usersWithEmail('NEW-seller@example.com')).toHaveLength(1);
      expect(occ.getData(`invites/${token}`)).toMatchObject({ usedAt: expect.any(Date) });
    });

    it('받는 사람이 지정된 초대에 다른 이메일로 가입하면 409 recipient_mismatch이고 토큰은 쓰이지 않는다', async () => {
      const issued = await issue({ recipientEmail: 'new-seller@example.com' }).expect(201);
      const token = issued.body.token as string;

      const rejected = await registerSeller(token, 'other@example.com').expect(409);

      expect(rejected.body).toMatchObject({ statusCode: 409, reason: 'recipient_mismatch' });
      expect(usersWithEmail('other@example.com')).toHaveLength(0);
      expect(occ.getData(`invites/${token}`)).toMatchObject({ usedAt: null, usedBy: null });
      expect(occ.listData('emailIdentities/')).toHaveLength(0);

      // 지정된 받는 사람은 여전히 가입할 수 있다.
      await registerSeller(token, 'new-seller@example.com').expect(201);
      expect(sellerUsers()).toHaveLength(1);
    });

    it.each([
      { recipientEmail: 'not-an-email' },
      { recipientEmail: '' },
      { recipientEmail: 123 },
      { recipientEmail: `${'a'.repeat(250)}@example.com` },
      { unexpected: 'field' },
    ])('잘못된 발급 본문 %p는 400이고 초대 문서를 만들지 않는다', async (body) => {
      await issue(body).expect(400);

      expect(occ.listData('invites/')).toHaveLength(0);
    });

    it('받는 사람이 지정된 초대에 맞는 이메일과 다른 이메일이 동시에 가입하면 맞는 쪽만 성공한다', async () => {
      seedInvite(occ, 'BOUNDTOKEN000001', { recipientEmail: 'new-seller@example.com' });

      const [matched, mismatched] = await Promise.all([
        registerSeller('BOUNDTOKEN000001', 'new-seller@example.com'),
        registerSeller('BOUNDTOKEN000001', 'other@example.com'),
      ]);

      expect(matched.status).toBe(201);
      expect(mismatched.status).toBe(409);
      expect(mismatched.body).toMatchObject({ reason: 'recipient_mismatch' });
      expect(sellerUsers()).toHaveLength(1);
      expect(usersWithEmail('other@example.com')).toHaveLength(0);
      expect(occ.getData('invites/BOUNDTOKEN000001')).toMatchObject({
        usedBy: sellerUsers()[0]?.['id'],
      });
    });

    it('가입 사전 검사 뒤 트랜잭션 전에 만료되면 가입 트랜잭션이 410으로 거부하고 토큰을 쓰지 않는다', async () => {
      const expiresAtMs = Date.now() + 60_000;
      seedInvite(occ, 'EXPIRINGTOKEN001', { expiresAt: new Date(expiresAtMs) });
      occ.setBeforeAttempt(() => {
        jest.spyOn(Date, 'now').mockReturnValue(expiresAtMs + 1);
      });

      const response = await registerSeller('EXPIRINGTOKEN001').expect(410);

      expect(response.body).toMatchObject({ statusCode: 410 });
      expect(sellerUsers()).toHaveLength(0);
      expect(occ.listData('emailIdentities/')).toHaveLength(0);
      expect(occ.getData('invites/EXPIRINGTOKEN001')).toMatchObject({ usedAt: null, usedBy: null });
    });
  });

  describe('카카오 초대 가입(POST /auth/kakao-login + inviteToken)', () => {
    const INVITED_EMAIL = 'new-seller@example.com';

    function kakaoAccount(
      accessToken: string,
      kakaoId: string,
      email: string | null = INVITED_EMAIL,
      emailVerified = true,
    ) {
      kakaoProfiles[accessToken] = { kakaoId, email, emailVerified, name: '카카오 판매자' };
    }

    function kakaoSellerLogin(inviteToken?: string, accessToken = 'kakao-token-1') {
      return request(app.getHttpServer())
        .post('/auth/kakao-login')
        .send({ kakaoAccessToken: accessToken, targetRole: 'seller', inviteToken });
    }

    function kakaoUsers() {
      return occ.listData('users/').filter((user) => typeof user['kakaoId'] === 'string');
    }

    function seedRecipientInvite(token: string, overrides: Data = {}) {
      seedInvite(occ, token, { recipientEmail: INVITED_EMAIL, ...overrides });
    }

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('유효한 초대로 처음 로그인하면 판매자 계정이 생기고 초대에 사용 시각·사용 계정이 남는다', async () => {
      kakaoAccount('kakao-token-1', '9001');
      seedRecipientInvite('KAKAOINVITE00001');

      const response = await kakaoSellerLogin('KAKAOINVITE00001').expect(200);

      expect(response.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        user: { role: 'seller', storeId: null, kakaoId: '9001', providers: ['kakao'] },
      });
      const users = kakaoUsers();
      expect(users).toHaveLength(1);
      expect(occ.getData('invites/KAKAOINVITE00001')).toMatchObject({ usedBy: users[0]['id'] });
      expect(occ.getData('invites/KAKAOINVITE00001')?.['usedAt']).not.toBeNull();
      expect(occ.getData('kakaoIdentities/9001')).toMatchObject({ userId: users[0]['id'] });
    });

    it('초대 없이 처음 로그인하면 지금처럼 403이고 계정을 만들지 않는다', async () => {
      kakaoAccount('kakao-token-1', '9001');

      await kakaoSellerLogin().expect(403);

      expect(kakaoUsers()).toHaveLength(0);
    });

    it('만료된 초대는 410이고 계정을 만들지 않는다', async () => {
      kakaoAccount('kakao-token-1', '9001');
      seedRecipientInvite('KAKAOEXPIRED0001', { expiresAt: new Date(Date.now() - DAY_MS) });

      await kakaoSellerLogin('KAKAOEXPIRED0001').expect(410);

      expect(kakaoUsers()).toHaveLength(0);
      expect(occ.getData('invites/KAKAOEXPIRED0001')).toMatchObject({ usedAt: null });
    });

    it('관리자가 취소한 초대는 409 already_revoked이고 계정을 만들지 않는다', async () => {
      kakaoAccount('kakao-token-1', '9001');
      seedRecipientInvite('KAKAOREVOKED0001');
      await revoke('KAKAOREVOKED0001').expect(201);

      const response = await kakaoSellerLogin('KAKAOREVOKED0001').expect(409);

      expect(response.body).toMatchObject({ statusCode: 409, reason: 'already_revoked' });
      expect(kakaoUsers()).toHaveLength(0);
    });

    it('이미 쓴 초대로 다른 카카오 계정이 가입하면 409이고 두 번째 계정은 생기지 않는다', async () => {
      kakaoAccount('kakao-token-1', '9001');
      kakaoAccount('kakao-token-2', '9002');
      seedRecipientInvite('KAKAOUSED0000001');
      await kakaoSellerLogin('KAKAOUSED0000001', 'kakao-token-1').expect(200);
      const firstUsedBy = occ.getData('invites/KAKAOUSED0000001')?.['usedBy'];

      await kakaoSellerLogin('KAKAOUSED0000001', 'kakao-token-2').expect(409);

      expect(kakaoUsers()).toHaveLength(1);
      expect(occ.getData('invites/KAKAOUSED0000001')).toMatchObject({ usedBy: firstUsedBy });
    });

    it('없는 초대는 403, 형식이 틀린 초대는 400이고 계정을 만들지 않는다', async () => {
      kakaoAccount('kakao-token-1', '9001');

      await kakaoSellerLogin('NOSUCHINVITE0001').expect(403);
      await kakaoSellerLogin('BAD/TOKEN').expect(400);

      expect(kakaoUsers()).toHaveLength(0);
    });

    it('인증된 카카오 이메일이 받는 사람과 다르면 409 recipient_mismatch이고 초대를 쓰지 않는다', async () => {
      kakaoAccount('kakao-token-1', '9001', 'someone-else@example.com');
      seedRecipientInvite('KAKAOMISMATCH001');

      const response = await kakaoSellerLogin('KAKAOMISMATCH001').expect(409);

      expect(response.body).toMatchObject({ statusCode: 409, reason: 'recipient_mismatch' });
      expect(kakaoUsers()).toHaveLength(0);
      expect(occ.getData('invites/KAKAOMISMATCH001')).toMatchObject({ usedAt: null, usedBy: null });
    });

    it('인증된 카카오 이메일은 대소문자만 달라도 받는 사람과 같게 본다', async () => {
      kakaoAccount('kakao-token-1', '9001', 'New-Seller@Example.com');
      seedRecipientInvite('KAKAOCASE0000001');

      await kakaoSellerLogin('KAKAOCASE0000001').expect(200);

      expect(kakaoUsers()).toHaveLength(1);
    });

    it.each([
      ['카카오 이메일이 없으면', null, true],
      ['카카오 이메일이 인증되지 않았으면', 'someone-else@example.com', false],
    ])('%s 받는 사람 대조 없이 가입한다', async (_label, email, emailVerified) => {
      kakaoAccount('kakao-token-1', '9001', email, emailVerified);
      seedRecipientInvite('KAKAONOEMAIL0001');

      await kakaoSellerLogin('KAKAONOEMAIL0001').expect(200);

      const users = kakaoUsers();
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({ role: 'seller', email });
      expect(occ.getData('invites/KAKAONOEMAIL0001')).toMatchObject({ usedBy: users[0]['id'] });
    });

    it('같은 카카오 계정이 이미 손님으로 가입돼 있으면 판매자로 바꾸지 않고 409이며 초대를 쓰지 않는다', async () => {
      kakaoAccount('kakao-token-1', '9001');
      occ.seed('users/consumer-kakao', {
        id: 'consumer-kakao',
        kakaoId: '9001',
        role: 'consumer',
        storeId: null,
      });
      seedRecipientInvite('KAKAOEXISTING001');

      const response = await kakaoSellerLogin('KAKAOEXISTING001').expect(409);

      expect(response.body).toMatchObject({ statusCode: 409, reason: 'kakao_account_in_use' });
      expect(occ.getData('users/consumer-kakao')).toMatchObject({ role: 'consumer' });
      expect(occ.getData('invites/KAKAOEXISTING001')).toMatchObject({ usedAt: null, usedBy: null });
    });

    it('이미 판매자인 카카오 계정은 초대 링크로 들어와도 그대로 로그인하고 초대를 쓰지 않는다', async () => {
      kakaoAccount('kakao-token-1', '9001');
      occ.seed('users/seller-kakao', {
        id: 'seller-kakao',
        kakaoId: '9001',
        role: 'seller',
        storeId: 'store-9',
      });
      seedRecipientInvite('KAKAOSELLER00001');

      const response = await kakaoSellerLogin('KAKAOSELLER00001').expect(200);

      expect(response.body.user).toMatchObject({ id: 'seller-kakao', role: 'seller' });
      expect(occ.getData('invites/KAKAOSELLER00001')).toMatchObject({ usedAt: null, usedBy: null });
    });

    it('손님 앱 요청에 실린 초대 토큰은 무시하고 초대를 쓰지 않는다', async () => {
      kakaoAccount('kakao-token-1', '9001');
      seedRecipientInvite('KAKAOCONSUMER001');

      const response = await request(app.getHttpServer())
        .post('/auth/kakao-login')
        .send({
          kakaoAccessToken: 'kakao-token-1',
          targetRole: 'consumer',
          inviteToken: 'KAKAOCONSUMER001',
        })
        .expect(200);

      expect(response.body.user).toMatchObject({ role: 'consumer' });
      expect(occ.getData('invites/KAKAOCONSUMER001')).toMatchObject({ usedAt: null, usedBy: null });
    });

    it('서로 다른 카카오 계정이 같은 초대로 동시에 가입하면 한 계정만 생기고 초대는 그 계정이 쓴다', async () => {
      kakaoAccount('kakao-token-1', '9001');
      kakaoAccount('kakao-token-2', '9002');
      seedRecipientInvite('KAKAORACE0000001');

      const responses = await Promise.all([
        kakaoSellerLogin('KAKAORACE0000001', 'kakao-token-1'),
        kakaoSellerLogin('KAKAORACE0000001', 'kakao-token-2'),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const users = kakaoUsers();
      expect(users).toHaveLength(1);
      expect(occ.getData('invites/KAKAORACE0000001')).toMatchObject({ usedBy: users[0]['id'] });
    });

    it('같은 카카오 계정의 중복 콜백은 계정 하나만 만들고 둘 다 같은 판매자로 로그인한다', async () => {
      kakaoAccount('kakao-token-1', '9001');
      seedRecipientInvite('KAKAODOUBLE00001');

      const responses = await Promise.all([
        kakaoSellerLogin('KAKAODOUBLE00001', 'kakao-token-1'),
        kakaoSellerLogin('KAKAODOUBLE00001', 'kakao-token-1'),
      ]);

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const users = kakaoUsers();
      expect(users).toHaveLength(1);
      expect(responses.map((response) => response.body.user.id)).toEqual([
        users[0]['id'],
        users[0]['id'],
      ]);
      expect(occ.getData('invites/KAKAODOUBLE00001')).toMatchObject({ usedBy: users[0]['id'] });
    });

    it('사전 검사 뒤 관리자 취소가 먼저 커밋되면 가입 트랜잭션이 409 already_revoked로 거부한다', async () => {
      kakaoAccount('kakao-token-1', '9001');
      seedRecipientInvite('KAKAORACEREVOKE1');
      occ.setBeforeAttempt(async () => {
        occ.setBeforeAttempt(undefined);
        await adminService.revokeInvite('KAKAORACEREVOKE1', 'admin-1');
      });

      const response = await kakaoSellerLogin('KAKAORACEREVOKE1').expect(409);

      expect(response.body).toMatchObject({ statusCode: 409, reason: 'already_revoked' });
      expect(kakaoUsers()).toHaveLength(0);
    });
  });
});
