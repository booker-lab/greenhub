import { Controller, Get, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthController } from '../../auth/auth.controller';
import { AuthService } from '../../auth/auth.service';
import { ClientThrottlerGuard, clientIp, normalizedEmail } from './client-throttler.guard';

const ACCESS_SECRET = 'access-secret-for-throttler-spec-0123456789';
const REFRESH_SECRET = 'refresh-secret-for-throttler-spec-0123456789';
// 운영과 같은 한도: 전역 100/분, 인증 라우트는 @Throttle 10/분.
const DEFAULT_LIMIT = 100;
const AUTH_LIMIT = 10;

@Controller('probe')
class ProbeController {
  @Get()
  probe() {
    return { ok: true };
  }
}

const signer = new JwtService();
const accessToken = (sub: string, secret = ACCESS_SECRET) =>
  signer.sign({ sub, role: 'consumer' }, { secret, expiresIn: '1h' });
const refreshToken = (sub: string, secret = REFRESH_SECRET) =>
  signer.sign({ sub, role: 'consumer' }, { secret, expiresIn: '30d' });

async function createApp(trustProxyHops: number | false): Promise<INestApplication<App>> {
  const authService = {
    login: jest.fn().mockResolvedValue({ ok: true }),
    refresh: jest.fn().mockResolvedValue({ ok: true }),
    kakaoLogin: jest.fn().mockResolvedValue({ ok: true }),
    register: jest.fn().mockResolvedValue({ ok: true }),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'JWT_SECRET'
        ? ACCESS_SECRET
        : key === 'JWT_REFRESH_SECRET'
          ? REFRESH_SECRET
          : undefined,
    ),
  };

  const moduleRef = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot({
        throttlers: [{ name: 'default', ttl: 60000, limit: DEFAULT_LIMIT }],
      }),
    ],
    controllers: [AuthController, ProbeController],
    providers: [
      { provide: AuthService, useValue: authService },
      { provide: ConfigService, useValue: config },
      JwtService,
      { provide: APP_GUARD, useClass: ClientThrottlerGuard },
    ],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', trustProxyHops);
  await app.init();
  return app as unknown as INestApplication<App>;
}

async function hit(times: number, send: () => request.Test): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i += 1) {
    statuses.push((await send()).status);
  }
  return statuses;
}

describe('ClientThrottlerGuard 집계 기준', () => {
  let app: INestApplication<App>;

  afterEach(async () => {
    await app?.close();
  });

  it('trust proxy 1홉이면 위조한 X-Forwarded-For 앞부분을 바꿔도 같은 IP 버킷을 쓴다', async () => {
    app = await createApp(1);
    const server = app.getHttpServer();

    const statuses = await hit(DEFAULT_LIMIT + 1, () =>
      request(server)
        .get('/probe')
        // 클라이언트가 임의 값을 넣어도 신뢰 프록시가 덧붙인 마지막 값이 클라이언트 IP다.
        .set('X-Forwarded-For', `10.0.${Math.floor(Math.random() * 250)}.1, 203.0.113.7`),
    );

    expect(statuses.slice(0, DEFAULT_LIMIT).every((status) => status === 200)).toBe(true);
    expect(statuses[DEFAULT_LIMIT]).toBe(429);

    const otherClient = await request(server).get('/probe').set('X-Forwarded-For', '203.0.113.8');
    expect(otherClient.status).toBe(200);
  });

  it('trust proxy를 끄면 X-Forwarded-For를 무시하고 소켓 주소로 집계한다', async () => {
    app = await createApp(false);
    const server = app.getHttpServer();

    const statuses = await hit(DEFAULT_LIMIT + 1, () =>
      request(server)
        .get('/probe')
        .set('X-Forwarded-For', `198.51.100.${Math.floor(Math.random() * 250)}`),
    );

    expect(statuses[DEFAULT_LIMIT]).toBe(429);
  });

  it('서명 검증된 access token은 같은 IP를 공유해도 사용자별로 집계한다', async () => {
    app = await createApp(1);
    const server = app.getHttpServer();
    const shared = '203.0.113.20';

    const userA = await hit(DEFAULT_LIMIT + 1, () =>
      request(server)
        .get('/probe')
        .set('X-Forwarded-For', shared)
        .set('Authorization', `Bearer ${accessToken('user-a')}`),
    );
    expect(userA[DEFAULT_LIMIT]).toBe(429);

    const userB = await request(server)
      .get('/probe')
      .set('X-Forwarded-For', shared)
      .set('Authorization', `Bearer ${accessToken('user-b')}`);
    expect(userB.status).toBe(200);

    const anonymous = await request(server).get('/probe').set('X-Forwarded-For', shared);
    expect(anonymous.status).toBe(200);
  });

  it('서명이 맞지 않는 토큰은 sub를 바꿔도 IP 버킷으로 집계한다', async () => {
    app = await createApp(1);
    const server = app.getHttpServer();
    let counter = 0;

    const statuses = await hit(DEFAULT_LIMIT + 1, () => {
      counter += 1;
      return request(server)
        .get('/probe')
        .set('X-Forwarded-For', '203.0.113.30')
        .set('Authorization', `Bearer ${accessToken(`forged-${counter}`, 'wrong-secret')}`);
    });

    expect(statuses[DEFAULT_LIMIT]).toBe(429);
  });

  it('refresh token을 access token 자리에 넣어도 사용자 키로 인정하지 않는다', async () => {
    app = await createApp(1);
    const server = app.getHttpServer();
    let counter = 0;

    const statuses = await hit(DEFAULT_LIMIT + 1, () => {
      counter += 1;
      return request(server)
        .get('/probe')
        .set('X-Forwarded-For', '203.0.113.31')
        .set('Authorization', `Bearer ${refreshToken(`refresh-${counter}`)}`);
    });

    expect(statuses[DEFAULT_LIMIT]).toBe(429);
  });

  it('/auth/login은 같은 IP에서도 이메일별로 10회 한도를 따로 집계한다', async () => {
    app = await createApp(1);
    const server = app.getHttpServer();
    const shared = '203.0.113.40';
    const login = (email: string) =>
      request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', shared)
        .send({ email, password: 'password' });

    const first = await hit(AUTH_LIMIT + 1, () => login('Person@Example.test'));
    expect(first.slice(0, AUTH_LIMIT).every((status) => status === 200)).toBe(true);
    expect(first[AUTH_LIMIT]).toBe(429);

    // 대소문자·공백만 다른 같은 이메일은 같은 버킷이다.
    expect((await login('  person@example.test ')).status).toBe(429);
    // 같은 IP의 다른 이메일은 막히지 않는다.
    expect((await login('other@example.test')).status).toBe(200);
  });

  it('/auth/login의 같은 이메일도 다른 클라이언트 IP면 따로 집계한다', async () => {
    app = await createApp(1);
    const server = app.getHttpServer();
    const login = (ip: string) =>
      request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: 'person@example.test', password: 'password' });

    const first = await hit(AUTH_LIMIT + 1, () => login('203.0.113.50'));
    expect(first[AUTH_LIMIT]).toBe(429);
    expect((await login('203.0.113.51')).status).toBe(200);
  });

  it('/auth/refresh는 서명 검증된 refresh token의 sub별로 집계한다', async () => {
    app = await createApp(1);
    const server = app.getHttpServer();
    const shared = '203.0.113.60';
    const refresh = (token: string) =>
      request(server)
        .post('/auth/refresh')
        .set('X-Forwarded-For', shared)
        .send({ refreshToken: token });

    const userA = await hit(AUTH_LIMIT + 1, () => refresh(refreshToken('user-a')));
    expect(userA[AUTH_LIMIT]).toBe(429);
    expect((await refresh(refreshToken('user-b'))).status).toBe(200);
  });

  it('/auth/refresh의 검증 실패 토큰(access token 포함)은 IP 버킷으로 집계한다', async () => {
    app = await createApp(1);
    const server = app.getHttpServer();
    let counter = 0;

    const statuses = await hit(AUTH_LIMIT + 1, () => {
      counter += 1;
      return request(server)
        .post('/auth/refresh')
        .set('X-Forwarded-For', '203.0.113.61')
        .send({ refreshToken: accessToken(`access-${counter}`) });
    });

    expect(statuses[AUTH_LIMIT]).toBe(429);
  });

  it('/auth/kakao-login은 클라이언트 IP 기준 10회 한도를 유지한다', async () => {
    app = await createApp(1);
    const server = app.getHttpServer();
    let counter = 0;

    const statuses = await hit(AUTH_LIMIT + 1, () => {
      counter += 1;
      return request(server)
        .post('/auth/kakao-login')
        .set('X-Forwarded-For', '203.0.113.70')
        .send({ kakaoAccessToken: `token-${counter}` });
    });

    expect(statuses[AUTH_LIMIT]).toBe(429);
  });
});

describe('ClientThrottlerGuard 보조 함수', () => {
  it('req.ip가 없으면 소켓 주소, 둘 다 없으면 unknown을 쓴다', () => {
    expect(clientIp({ ip: '203.0.113.1' })).toBe('203.0.113.1');
    expect(clientIp({ socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1');
    expect(clientIp({})).toBe('unknown');
  });

  it('이메일은 문자열만 소문자·trim으로 정규화한다', () => {
    expect(normalizedEmail(' A@B.Test ')).toBe('a@b.test');
    expect(normalizedEmail(42)).toBeUndefined();
    expect(normalizedEmail('   ')).toBeUndefined();
    expect(normalizedEmail(`${'a'.repeat(400)}@b.test`)).toBeUndefined();
  });
});
