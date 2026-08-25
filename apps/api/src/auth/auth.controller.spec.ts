import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuditService } from '../common/audit/audit.service';
import { FirestoreService } from '../firestore/firestore.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
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

      throw new Error(`Unexpected document path: ${path}`);
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
