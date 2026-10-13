import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { FirestoreService } from '../firestore/firestore.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

type Role = 'consumer' | 'seller' | 'driver' | 'admin';

const JWT_SECRET = 'auth-token-boundary-test-secret';

const USERS: Record<string, Record<string, unknown>> = {
  'consumer-1': { id: 'consumer-1', role: 'consumer', storeId: null },
  'seller-1': { id: 'seller-1', role: 'seller', storeId: 'store-1' },
  'driver-1': { id: 'driver-1', role: 'driver', storeId: null, driverApproved: true },
  'admin-1': { id: 'admin-1', role: 'admin', storeId: null },
};

describe('AuthController 토큰 검증·firebase-token 역할 경계', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  const authService = {
    getFirebaseToken: jest.fn().mockResolvedValue('firebase-custom-token'),
    getSession: jest.fn().mockResolvedValue({ sub: 'consumer-1', role: 'consumer' }),
  };
  const firestore = {
    doc: jest.fn((path: string) => {
      const user = USERS[path.slice('users/'.length)];
      return { get: jest.fn().mockResolvedValue({ exists: user !== undefined, data: () => user }) };
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: JWT_SECRET })],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: FirestoreService, useValue: firestore },
        { provide: ConfigService, useValue: new ConfigService({ JWT_SECRET }) },
        JwtAuthGuard,
        RolesGuard,
        JwtStrategy,
      ],
    }).compile();

    app = module.createNestApplication();
    jwt = app.get(JwtService);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function tokenFor(role: Role, claims: Record<string, unknown> = {}, options = {}) {
    const user = USERS[`${role}-1`];
    return jwt.sign(
      { sub: user['id'], role, storeId: user['storeId'], ...claims },
      { secret: JWT_SECRET, ...options },
    );
  }

  it.each([
    'seller',
    'driver',
    'admin',
  ] as const)('%s는 Firebase custom token을 받는다', async (role) => {
    await request(app.getHttpServer())
      .get('/auth/firebase-token')
      .set('Authorization', `Bearer ${tokenFor(role, { typ: 'access', aud: 'greenhub-api' })}`)
      .expect(200);
    expect(authService.getFirebaseToken).toHaveBeenCalledWith(`${role}-1`);
  });

  it('consumer는 Firebase custom token을 받지 못한다', async () => {
    await request(app.getHttpServer())
      .get('/auth/firebase-token')
      .set('Authorization', `Bearer ${tokenFor('consumer', { typ: 'access' })}`)
      .expect(403);
    expect(authService.getFirebaseToken).not.toHaveBeenCalled();
  });

  it('typ·aud가 없는 기존 access 토큰은 만료 전까지 통과한다', async () => {
    await request(app.getHttpServer())
      .get('/auth/session')
      .set('Authorization', `Bearer ${tokenFor('consumer')}`)
      .expect(200);
  });

  it.each([
    ['refresh 종류 토큰', { typ: 'refresh' }, {}],
    ['다른 수신자 토큰', { typ: 'access', aud: 'other-service' }, {}],
    ['HS256이 아닌 알고리즘', { typ: 'access' }, { algorithm: 'HS512' }],
  ])('%s는 401로 거부하고 사용자 조회도 하지 않는다', async (_label, claims, options) => {
    await request(app.getHttpServer())
      .get('/auth/session')
      .set('Authorization', `Bearer ${tokenFor('consumer', claims, options)}`)
      .expect(401);
    expect(authService.getSession).not.toHaveBeenCalled();
    expect(firestore.doc).not.toHaveBeenCalled();
  });
});
