import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuditService } from '../common/audit/audit.service';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { FirestoreService } from '../firestore/firestore.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { KakaoClient } from './kakao.client';

// 운영 런타임의 이메일 로그인·가입 제한을 HTTP 경로(입력 검증 → 컨트롤러 → 서비스)로 확인한다.
// - login: 심사 허용 표식이 없는 계정(여기서는 없는 계정)은 사용자 조회만 거치고 403이다. 토큰 발급·감사 기록·
//   다른 문서 접근이 없어야 한다.
// - register: 계정·초대 조회 전에 403이므로 Firestore는 어떤 호출이든 실패하게 둔다.
function failOnFirestore(path: string): never {
  throw new Error(`운영 차단 전에 Firestore에 접근했습니다: ${path}`);
}

describe('운영 런타임 이메일 인증 경로(HTTP)', () => {
  let app: INestApplication<App>;
  const usersQuery = {
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
  };
  const firestore = {
    collection: jest.fn((path: string) => (path === 'users' ? usersQuery : failOnFirestore(path))),
    doc: jest.fn(failOnFirestore),
    runTransaction: jest.fn(() => failOnFirestore('runTransaction')),
  };
  const jwt = { sign: jest.fn(), verify: jest.fn() };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const values: Record<string, string> = {
    RAILWAY_ENVIRONMENT_NAME: 'production',
    JWT_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
  };
  // 실행 환경의 process.env와 섞이지 않도록 주어진 값만 돌려준다.
  const config = { get: jest.fn((key: string) => values[key]) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: FirestoreService, useValue: firestore },
        { provide: ConfigService, useValue: config },
        { provide: JwtService, useValue: jwt },
        { provide: KakaoClient, useValue: { getUser: jest.fn() } },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(sanitizedValidationPipeOptions()));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('POST /auth/login은 심사 허용 표식이 없으면 403이고 사용자 조회 외 접근·토큰 발급·감사 기록이 없다', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'seller@example.com', password: 'password-123' })
      .expect(403)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          statusCode: 403,
          message: '이메일 로그인은 지원하지 않습니다.',
        });
        expect(body).not.toHaveProperty('accessToken');
      });

    expect(firestore.collection).toHaveBeenCalledTimes(1);
    expect(firestore.collection).toHaveBeenCalledWith('users');
    expect(firestore.doc).not.toHaveBeenCalled();
    expect(firestore.runTransaction).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it.each([
    ['consumer', { role: 'consumer' }],
    ['초대 토큰이 있는 판매자', { role: 'seller', inviteToken: 'INVITE0000000001' }],
  ])('POST /auth/register(%s)는 403이고 사용자·초대 문서에 닿지 않는다', async (_label, fields) => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'new@example.com', password: 'password-123', name: '새 사용자', ...fields })
      .expect(403)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          statusCode: 403,
          message: '이메일 회원가입은 지원하지 않습니다.',
        });
      });

    expect(firestore.collection).not.toHaveBeenCalled();
    expect(firestore.doc).not.toHaveBeenCalled();
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });
});
