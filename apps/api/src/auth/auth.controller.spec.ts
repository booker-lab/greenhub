import { type ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuditService } from '../common/audit/audit.service';
import { FirestoreService } from '../firestore/firestore.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  ADDRESS_DETAIL_MAX_LENGTH,
  ADDRESS_LABEL_MAX_LENGTH,
  ADDRESS_MAX_LENGTH,
  ADDRESS_ZIP_CODE_MAX_LENGTH,
} from './dto/address.dto';
import { FCM_TOKEN_MAX_LENGTH } from './dto/fcm-token.dto';
import { KakaoClient } from './kakao.client';

type UserRecord = Record<string, unknown>;
type UsersQuery = {
  where: (_field: string, _operator: string, value: string) => UsersQuery;
  limit: () => UsersQuery;
  get: () => Promise<{
    empty: boolean;
    docs: Array<{ data: () => UserRecord }>;
  }>;
};

function makeAuthHarness() {
  const users = new Map<string, UserRecord>();
  const refreshTokenWrites: Array<{ path: string; data: UserRecord }> = [];
  const emailIdentities = new Map<string, UserRecord>();
  let emailFilter = '';

  const usersQuery: UsersQuery = {
    where: (_field: string, _operator: string, value: string) => {
      emailFilter = value;
      return usersQuery;
    },
    limit: () => usersQuery,
    get: () => {
      const matches = [...users.values()].filter((user) => user.email === emailFilter);
      return Promise.resolve({
        empty: matches.length === 0,
        docs: matches.map((user) => ({ data: () => user })),
      });
    },
  };

  const firestore = {
    collection: (path: string) => {
      if (path === 'users') return usersQuery;
      throw new Error(`Unexpected collection path: ${path}`);
    },
    doc: (path: string) => {
      if (path.startsWith('users/')) {
        const userId = path.slice('users/'.length);
        return {
          get: () => {
            const user = users.get(userId);
            return Promise.resolve({ exists: user !== undefined, data: () => user });
          },
          set: (data: UserRecord) => {
            users.set(userId, data);
            return Promise.resolve();
          },
        };
      }

      if (path.startsWith('refreshTokens/')) {
        return {
          set: (data: UserRecord) => {
            refreshTokenWrites.push({ path, data });
            return Promise.resolve();
          },
        };
      }

      if (path.startsWith('emailIdentities/')) {
        return {
          get: () => {
            const identity = emailIdentities.get(path);
            return Promise.resolve({ exists: identity !== undefined, data: () => identity });
          },
          create: (data: UserRecord) => {
            if (emailIdentities.has(path)) {
              return Promise.reject(Object.assign(new Error('already exists'), { code: 6 }));
            }
            emailIdentities.set(path, data);
            return Promise.resolve();
          },
        };
      }

      throw new Error(`Unexpected document path: ${path}`);
    },
    // 테스트용 트랜잭션: 읽기는 즉시, 쓰기는 콜백이 끝난 뒤 순서대로 반영한다.
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      type TxRef = {
        get: () => Promise<unknown>;
        set?: (data: UserRecord) => Promise<void>;
        create?: (data: UserRecord) => Promise<void>;
      };
      const writes: Array<() => Promise<void> | undefined> = [];
      const result = await fn({
        get: (ref: TxRef) => ref.get(),
        set: (ref: TxRef, data: UserRecord) => writes.push(() => ref.set?.(data)),
        create: (ref: TxRef, data: UserRecord) => writes.push(() => ref.create?.(data)),
      });
      for (const write of writes) await write();
      return result;
    },
    Timestamp: { now: jest.fn(() => 'now') },
  };

  const jwt = {
    sign: jest.fn(
      (_payload: Record<string, unknown>, options: { secret?: string }) =>
        options.secret === 'access-secret' ? 'access-token' : 'refresh-token',
    ),
    verify: jest.fn(),
  };
  const config = new ConfigService({
    JWT_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    JWT_EXPIRES_IN: '1h',
    JWT_REFRESH_EXPIRES_IN: '30d',
  });
  const kakaoClient = { getUser: jest.fn() };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };

  return {
    audit,
    config,
    emailIdentities,
    firestore,
    jwt,
    kakaoClient,
    refreshTokenWrites,
    users,
  };
}

describe('AuthController public driver approval boundary', () => {
  let app: INestApplication<App>;
  let harness: ReturnType<typeof makeAuthHarness>;

  beforeEach(async () => {
    harness = makeAuthHarness();
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: FirestoreService, useValue: harness.firestore },
        { provide: ConfigService, useValue: harness.config },
        { provide: JwtService, useValue: harness.jwt },
        { provide: KakaoClient, useValue: harness.kakaoClient },
        { provide: AuditService, useValue: harness.audit },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('public register→login keeps a driver approval-pending and rejects before token issuance', async () => {
    const email = 'pending-driver@example.com';
    const password = 'password-123';

    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: '신청 기사', role: 'driver' })
      .expect(201);

    const userId = (registration.body as { userId: string }).userId;
    expect(harness.users.get(userId)).toEqual(
      expect.objectContaining({ role: 'driver', driverApproved: false }),
    );

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(403);

    expect(harness.jwt.sign).not.toHaveBeenCalled();
    expect(harness.refreshTokenWrites).toHaveLength(0);
  });

  it('public registration rejects a client-supplied driverApproved field', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'forged-driver@example.com',
        password: 'password-123',
        name: '위조 기사',
        role: 'driver',
        driverApproved: true,
      })
      .expect(400);

    expect(harness.users.size).toBe(0);
  });

  it.each([
    ['false', { driverApproved: false }],
    ['missing', {}],
  ])('public login rejects %s driver approval before token issuance', async (_label, approval) => {
    const password = 'password-123';
    harness.users.set('driver-1', {
      id: 'driver-1',
      email: 'driver@example.com',
      name: '기사',
      role: 'driver',
      suspended: false,
      passwordHash: await bcrypt.hash(password, 4),
      ...approval,
    });

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'driver@example.com', password })
      .expect(403);

    expect(harness.jwt.sign).not.toHaveBeenCalled();
    expect(harness.refreshTokenWrites).toHaveLength(0);
  });

  it('approved driver public login issues normal access and refresh tokens', async () => {
    const password = 'password-123';
    harness.users.set('driver-1', {
      id: 'driver-1',
      email: 'driver@example.com',
      name: '승인 기사',
      role: 'driver',
      driverApproved: true,
      suspended: false,
      passwordHash: await bcrypt.hash(password, 4),
    });

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'driver@example.com', password })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
        );
      });

    expect(harness.jwt.sign).toHaveBeenCalledTimes(2);
    expect(harness.refreshTokenWrites).toHaveLength(1);
  });

  it.each(['consumer', 'seller', 'admin'])('%s public login remains allowed', async (role) => {
    const password = 'password-123';
    harness.users.set(`${role}-1`, {
      id: `${role}-1`,
      email: `${role}@example.com`,
      name: role,
      role,
      suspended: false,
      passwordHash: await bcrypt.hash(password, 4),
    });

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `${role}@example.com`, password })
      .expect(200);
  });
});

describe('AuthController GET /auth/session wiring', () => {
  it('JwtAuthGuard 통과 시 service getSession projection을 반환한다', async () => {
    const getSession = jest.fn().mockResolvedValue({ sub: 'u-1', role: 'consumer' });
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: { getSession } }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const app = module.createNestApplication();
    await app.init();
    try {
      await request(app.getHttpServer())
        .get('/auth/session')
        .expect(200)
        .expect(({ body }) => {
          expect(body).toEqual({ sub: 'u-1', role: 'consumer' });
        });
      expect(getSession).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});

describe('AuthController 입력 검증(fcm-token·배송지)', () => {
  let app: INestApplication<App>;
  const authService = {
    updateFcmToken: jest.fn().mockResolvedValue(undefined),
    addAddress: jest.fn().mockResolvedValue({ id: 'addr-1' }),
    updateAddress: jest.fn().mockResolvedValue({ id: 'addr-1' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = { sub: 'user-1', role: 'consumer' };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it.each([
    ['문자열 토큰', { fcmToken: 'token-abc' }, 'token-abc'],
    ['null(토큰 지우기)', { fcmToken: null }, null],
    [
      `${FCM_TOKEN_MAX_LENGTH}자`,
      { fcmToken: 'a'.repeat(FCM_TOKEN_MAX_LENGTH) },
      'a'.repeat(FCM_TOKEN_MAX_LENGTH),
    ],
  ])('fcm-token: %s는 저장한다', async (_label, body, expected) => {
    await request(app.getHttpServer()).patch('/auth/me/fcm-token').send(body).expect(204);
    expect(authService.updateFcmToken).toHaveBeenCalledWith('user-1', expected);
  });

  it.each([
    ['누락', {}],
    ['숫자', { fcmToken: 123 }],
    ['객체', { fcmToken: { nested: 'x' } }],
    ['길이 초과', { fcmToken: 'a'.repeat(FCM_TOKEN_MAX_LENGTH + 1) }],
    ['알 수 없는 필드', { fcmToken: 'token', extra: 'x' }],
  ])('fcm-token: %s는 400이고 저장하지 않는다', async (_label, body) => {
    await request(app.getHttpServer()).patch('/auth/me/fcm-token').send(body).expect(400);
    expect(authService.updateFcmToken).not.toHaveBeenCalled();
  });

  const validAddress = {
    label: '집',
    address: '서울시 중구 세종대로 1',
    addressDetail: '',
    zipCode: '04524',
  };

  it('상한 안의 배송지는 추가·수정한다', async () => {
    const atLimit = {
      label: 'ㄱ'.repeat(ADDRESS_LABEL_MAX_LENGTH),
      address: 'ㄱ'.repeat(ADDRESS_MAX_LENGTH),
      addressDetail: 'ㄱ'.repeat(ADDRESS_DETAIL_MAX_LENGTH),
      zipCode: '1'.repeat(ADDRESS_ZIP_CODE_MAX_LENGTH),
    };
    await request(app.getHttpServer()).post('/auth/me/addresses').send(validAddress).expect(201);
    await request(app.getHttpServer()).post('/auth/me/addresses').send(atLimit).expect(201);
    await request(app.getHttpServer()).patch('/auth/me/addresses/addr-1').send(atLimit).expect(200);
    expect(authService.addAddress).toHaveBeenCalledTimes(2);
    expect(authService.updateAddress).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['label', ADDRESS_LABEL_MAX_LENGTH],
    ['address', ADDRESS_MAX_LENGTH],
    ['addressDetail', ADDRESS_DETAIL_MAX_LENGTH],
    ['zipCode', ADDRESS_ZIP_CODE_MAX_LENGTH],
  ])('배송지 %s가 상한(%i자)을 넘으면 400이다', async (field, max) => {
    const body = { ...validAddress, [field]: 'a'.repeat(max + 1) };

    await request(app.getHttpServer()).post('/auth/me/addresses').send(body).expect(400);
    await request(app.getHttpServer()).patch('/auth/me/addresses/addr-1').send(body).expect(400);
    expect(authService.addAddress).not.toHaveBeenCalled();
    expect(authService.updateAddress).not.toHaveBeenCalled();
  });
});
