import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import type { ValidationError } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { FirestoreService } from '../../firestore/firestore.service';
import { AuthController } from '../../auth/auth.controller';
import { AuthService } from '../../auth/auth.service';
import { KakaoClient } from '../../auth/kakao.client';
import {
  flattenValidationMessages,
  projectValidationFields,
  sanitizedValidationExceptionFactory,
  sanitizedValidationPipeOptions,
} from './sanitized-validation';

// PILOT-AUTH-SANITIZED-VALIDATION-OBSERVABILITY-AND-EXACT-REVERIFY-34A.
// Focused tests (OBSERVABILITY ONLY, acceptance unchanged).
// Fixture strings below are synthetic test markers only; assertions prove
// they never enter the sanitized diagnostic serialization.

const INVALID_EMAIL_FIXTURE = 'not-an-email-34a-fixture';
const VALID_EMAIL_FIXTURE = 'sanitized-34a-valid@example.test';
const VALID_PASSWORD_FIXTURE = 'sanitized-34a-valid-password';
const DISTINCT_NON_STRING_PASSWORD = 987654321;
const EXTRA_PROP_FIXTURE = 'sanitized34aExtra';
const SECRET_VALUE_FIXTURE = 'secret-value-must-never-appear-34a';
const SECRET_TARGET_FIXTURE = 'secret-target-must-never-appear-34a';

function emailIsEmailError(emailMessage = 'email must be an email'): ValidationError {
  return { property: 'email', constraints: { isEmail: emailMessage } } as ValidationError;
}

function passwordIsStringError(
  message = 'password must be a string',
): ValidationError {
  return { property: 'password', constraints: { isString: message } } as ValidationError;
}

describe('sanitized validation projection (34A observability only)', () => {
  it('1: invalid email projects email/isEmail only', () => {
    const fields = projectValidationFields([emailIsEmailError()]);
    expect(fields).toEqual([{ property: 'email', constraints: ['isEmail'] }]);
  });

  it('2: non-string password projects password/isString only', () => {
    const fields = projectValidationFields([passwordIsStringError()]);
    expect(fields).toEqual([{ property: 'password', constraints: ['isString'] }]);
  });

  it('3: pipe options preserve acceptance contract (whitelist + forbidNonWhitelisted)', () => {
    const options = sanitizedValidationPipeOptions();
    expect(options.whitelist).toBe(true);
    expect(options.forbidNonWhitelisted).toBe(true);
    expect(typeof options.exceptionFactory).toBe('function');
  });

  it('5: diagnostic serialization never exposes value/target/input contents', () => {
    const errors = [
      {
        property: 'email',
        value: INVALID_EMAIL_FIXTURE,
        target: { email: SECRET_TARGET_FIXTURE, password: SECRET_VALUE_FIXTURE },
        constraints: { isEmail: 'email must be an email' },
      },
      {
        property: 'password',
        value: SECRET_VALUE_FIXTURE,
        target: SECRET_TARGET_FIXTURE,
        constraints: { isString: 'password must be a string' },
      },
    ] as unknown as ValidationError[];
    const fields = projectValidationFields(errors);
    expect(fields).toEqual([
      { property: 'email', constraints: ['isEmail'] },
      { property: 'password', constraints: ['isString'] },
    ]);
    const serialized = JSON.stringify(fields);
    for (const forbidden of [
      INVALID_EMAIL_FIXTURE,
      SECRET_VALUE_FIXTURE,
      SECRET_TARGET_FIXTURE,
    ]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
    // Structural exclusion: only property + constraints keys exist.
    for (const field of fields) {
      expect(Object.keys(field).sort()).toEqual(['constraints', 'property']);
    }
    // Factory response body also excludes values/targets.
    const exception = sanitizedValidationExceptionFactory(errors) as {
      getResponse: () => unknown;
    };
    const bodyText = JSON.stringify(exception.getResponse());
    for (const forbidden of [
      INVALID_EMAIL_FIXTURE,
      SECRET_VALUE_FIXTURE,
      SECRET_TARGET_FIXTURE,
    ]) {
      expect(bodyText.includes(forbidden)).toBe(false);
    }
    expect(bodyText.includes('"value"')).toBe(false);
    expect(bodyText.includes('"target"')).toBe(false);
  });

  it('6: nested errors project property path + constraint keys only', () => {
    const errors = [
      {
        property: 'address',
        children: [
          {
            property: 'zipCode',
            value: SECRET_VALUE_FIXTURE,
            target: SECRET_TARGET_FIXTURE,
            constraints: { isString: 'zipCode must be a string' },
          },
        ],
      },
    ] as unknown as ValidationError[];
    const fields = projectValidationFields(errors);
    expect(fields).toEqual([{ property: 'address.zipCode', constraints: ['isString'] }]);
    const serialized = JSON.stringify(fields);
    expect(serialized.includes(SECRET_VALUE_FIXTURE)).toBe(false);
    expect(serialized.includes(SECRET_TARGET_FIXTURE)).toBe(false);
  });

  it('output ordering is deterministic regardless of input order', () => {
    const forward = projectValidationFields([
      passwordIsStringError(),
      emailIsEmailError(),
    ]);
    const reverse = projectValidationFields([
      emailIsEmailError(),
      passwordIsStringError(),
    ]);
    expect(forward).toEqual(reverse);
    expect(forward).toEqual([
      { property: 'email', constraints: ['isEmail'] },
      { property: 'password', constraints: ['isString'] },
    ]);
  });

  it('default messages are preserved alongside the additive projection', () => {
    const errors = [emailIsEmailError('email must be an email')];
    expect(flattenValidationMessages(errors)).toEqual(['email must be an email']);
    const exception = sanitizedValidationExceptionFactory(errors) as {
      getResponse: () => Record<string, unknown>;
    };
    const body = exception.getResponse();
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(body.message).toEqual(['email must be an email']);
    expect(body.validation).toEqual({
      fields: [{ property: 'email', constraints: ['isEmail'] }],
    });
  });
});

// ---- Integration: /auth/login 400 contract + sanitized metadata ----

type UserRecord = Record<string, unknown>;

function makeAuthHarness() {
  const users = new Map<string, UserRecord>();
  let emailFilter = '';
  const usersQuery = {
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
        return { set: () => Promise.resolve() };
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
  return {
    config,
    firestore,
    jwt,
    kakaoClient: { getUser: jest.fn() },
    audit: { log: jest.fn().mockResolvedValue(undefined) },
    users,
  };
}

describe('AuthController sanitized 400 contract (34A)', () => {
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
    app.useGlobalPipes(new ValidationPipe(sanitizedValidationPipeOptions()));
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('1: invalid email 400 exposes email/isEmail only (no values)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: INVALID_EMAIL_FIXTURE, password: VALID_PASSWORD_FIXTURE })
      .expect(400);
    expect(res.body.statusCode).toBe(400);
    expect(res.body.error).toBe('Bad Request');
    expect(res.body.validation).toEqual({
      fields: [{ property: 'email', constraints: ['isEmail'] }],
    });
    const raw = JSON.stringify(res.body);
    expect(raw.includes(INVALID_EMAIL_FIXTURE)).toBe(false);
    expect(raw.includes(VALID_PASSWORD_FIXTURE)).toBe(false);
    expect(raw.includes('"value"')).toBe(false);
    expect(raw.includes('"target"')).toBe(false);
  });

  it('2: non-string password 400 exposes password/isString only (no values)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: VALID_EMAIL_FIXTURE, password: DISTINCT_NON_STRING_PASSWORD })
      .expect(400);
    expect(res.body.validation).toEqual({
      fields: [{ property: 'password', constraints: ['isString'] }],
    });
    const raw = JSON.stringify(res.body);
    expect(raw.includes(VALID_EMAIL_FIXTURE)).toBe(false);
    expect(raw.includes(String(DISTINCT_NON_STRING_PASSWORD))).toBe(false);
    expect(raw.includes('"value"')).toBe(false);
    expect(raw.includes('"target"')).toBe(false);
  });

  it('3: extra property keeps forbidNonWhitelisted 400 rejection', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: VALID_EMAIL_FIXTURE,
        password: VALID_PASSWORD_FIXTURE,
        [EXTRA_PROP_FIXTURE]: 'x',
      })
      .expect(400);
    // Rejection itself is preserved; sanitized projection names the extra
    // property key (a key name, never a credential/body value).
    const fields = (res.body.validation?.fields ?? []) as Array<{
      property: string;
      constraints: string[];
    }>;
    expect(fields).toEqual([
      { property: EXTRA_PROP_FIXTURE, constraints: ['whitelistValidation'] },
    ]);
    const raw = JSON.stringify(res.body);
    expect(raw.includes(VALID_EMAIL_FIXTURE)).toBe(false);
    expect(raw.includes(VALID_PASSWORD_FIXTURE)).toBe(false);
  });

  it('4: valid LoginDto keeps the existing normal path unchanged', async () => {
    harness.users.set('consumer-1', {
      id: 'consumer-1',
      email: VALID_EMAIL_FIXTURE,
      name: 'consumer',
      role: 'consumer',
      suspended: false,
      passwordHash: await bcrypt.hash(VALID_PASSWORD_FIXTURE, 4),
    });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: VALID_EMAIL_FIXTURE, password: VALID_PASSWORD_FIXTURE })
      .expect(200);
    expect(res.body.accessToken).toBe('access-token');
    expect(res.body.refreshToken).toBe('refresh-token');
    expect(res.body.validation).toBeUndefined();
  });
});
