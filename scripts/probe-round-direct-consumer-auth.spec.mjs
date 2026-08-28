import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  APPLICATION_SHA,
  CALLBACK_CLASSIFICATIONS,
  DIRECT_API_LOGIN_PROBE_RESULT,
  EVIDENCE_CANDIDATE_REF,
  EXPECTED_API_ORIGIN,
  EXPECTED_CONSUMER_DEPLOYMENT_ID,
  EXPECTED_CONSUMER_PROJECT_ID,
  EXPECTED_CONSUMER_PROJECT_NAME,
  buildCallbackRequestInit,
  classifyApiOriginEvidence,
  classifyCallback,
  extractCookieNames,
  extractSafeAuthErrorCode,
  runProbe,
  validateExactV2Evidence,
} from './probe-round-direct-consumer-auth.mjs';

const OTHER_SHA = 'a'.repeat(40);
const TARGET_URL = 'https://greenhubconsumer-abc123.vercel.app';

function response({ status, headers = {}, jsonValue, textValue }) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    status,
    headers: {
      get(name) {
        const value = normalizedHeaders[name.toLowerCase()];
        return Array.isArray(value) ? value.join(', ') : (value ?? null);
      },
      getSetCookie() {
        const value = normalizedHeaders['set-cookie'];
        return Array.isArray(value) ? value : value ? [value] : [];
      },
    },
    async json() {
      if (jsonValue instanceof Error) throw jsonValue;
      return jsonValue;
    },
    async text() {
      if (textValue instanceof Error) throw textValue;
      return textValue ?? '';
    },
  };
}

function validEvidence(overrides = {}) {
  return {
    ready: true,
    source: 'github-status+vercel-api',
    expectedSha: APPLICATION_SHA,
    candidateRef: EVIDENCE_CANDIDATE_REF,
    railway: { ready: true },
    apps: [
      {
        app: 'consumer',
        ready: true,
        deploymentId: EXPECTED_CONSUMER_DEPLOYMENT_ID,
        projectId: EXPECTED_CONSUMER_PROJECT_ID,
        projectName: EXPECTED_CONSUMER_PROJECT_NAME,
        deploymentSha: APPLICATION_SHA,
        state: 'READY',
        targetUrl: TARGET_URL,
      },
      { app: 'seller', ready: true },
      { app: 'driver', ready: true },
    ],
    ...overrides,
  };
}

describe('Consumer 인증 probe secret-safe 계약', () => {
  it('callback request는 redirect manual을 사용한다', () => {
    const init = buildCallbackRequestInit({
      email: 'consumer@example.test',
      password: 'password-only-test',
      csrfToken: 'csrf-only-test',
      callbackUrl: TARGET_URL,
      testSecret: 'header-only-test',
      cookies: '__Host-authjs.csrf-token=csrf-cookie-only-test',
    });

    assert.equal(init.redirect, 'manual');
    assert.equal(init.method, 'POST');
    assert.match(init.body, /csrfToken=csrf-only-test/);
    assert.equal(init.headers['x-e2e-test-token'], 'header-only-test');
  });

  it('Set-Cookie 값은 버리고 cookie 이름만 정확히 추출한다', () => {
    const names = extractCookieNames([
      '__Host-authjs.csrf-token=csrf-value; Path=/; Secure',
      '__Secure-authjs.session-token=session-value; Path=/; Secure',
      'authjs.callback-url=https%3A%2F%2Fexample.test; Path=/',
      'prefs=one=two; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/',
    ]);
    const output = JSON.stringify({ setCookieCount: names.length, cookieNames: names });
    assert.deepEqual(names, [
      '__Host-authjs.csrf-token',
      '__Secure-authjs.session-token',
      'authjs.callback-url',
      'prefs',
    ]);
    assert.doesNotMatch(output, /csrf-value|session-value|one=two/);
  });

  it('오류 출력은 자격증명·토큰 값을 포함하지 않는다', () => {
    const secrets = ['email@example.test', 'password-secret', 'csrf-secret', 'bypass-secret', 'header-secret'];
    const safeOutput = {
      failureCode: 'CALLBACK_REQUEST_FAILED',
      callback: { status: 502, responseClass: '5xx', location: null, cookieNames: [] },
      directApiLoginProbe: DIRECT_API_LOGIN_PROBE_RESULT,
    };
    const output = JSON.stringify(safeOutput);
    for (const secret of secrets) assert.doesNotMatch(output, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('가짜 HTTP 응답으로 원본 callback·세션·public build 결과를 값 없이 만든다', async () => {
    const secrets = {
      bypass: 'bypass-secret-only-test',
      test: 'header-secret-only-test',
      email: 'consumer@example.test',
      password: 'password-secret-only-test',
      csrf: 'csrf-secret-only-test',
      bypassCookie: 'vercel-cookie-only-test',
      csrfCookie: 'csrf-cookie-only-test',
      sessionCookie: 'session-cookie-only-test',
      accessToken: 'access-token-only-test',
    };
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      if (url.includes('x-vercel-protection-bypass=')) {
        return response({
          status: 302,
          headers: {
            location: '/',
            'set-cookie': `_vercel_jwt=${secrets.bypassCookie}; Path=/; Secure`,
          },
        });
      }
      if (url.endsWith('/api/auth/csrf')) {
        return response({
          status: 200,
          headers: {
            'set-cookie': `__Host-authjs.csrf-token=${secrets.csrfCookie}; Path=/; Secure`,
          },
          jsonValue: { csrfToken: secrets.csrf },
        });
      }
      if (url.endsWith('/api/auth/callback/credentials')) {
        return response({
          status: 302,
          headers: {
            location: '/',
            'set-cookie': `__Secure-authjs.session-token=${secrets.sessionCookie}; Path=/; Secure`,
          },
        });
      }
      if (url.endsWith('/api/auth/session')) {
        return response({
          status: 200,
          jsonValue: { user: { role: 'consumer', accessToken: secrets.accessToken } },
        });
      }
      if (url.endsWith('/')) {
        return response({
          status: 200,
          textValue: `const API = '${EXPECTED_API_ORIGIN}'; fetch(API + '/auth/login')`,
        });
      }
      throw new Error('예상하지 않은 가짜 요청');
    };

    const result = await runProbe({
      expectedSha: APPLICATION_SHA,
      evidence: validEvidence(),
      bypassSecret: secrets.bypass,
      testSecret: secrets.test,
      email: secrets.email,
      password: secrets.password,
      fetchImpl,
    });
    const serialized = JSON.stringify(result);

    assert.equal(result.vercelBypassCookiePresent, true);
    assert.equal(result.csrfCookiePresent, true);
    assert.equal(result.callback.classification, CALLBACK_CLASSIFICATIONS.SESSION_ISSUED);
    assert.equal(result.callback.sessionCookiePresent, true);
    assert.equal(result.authenticatedSessionPresent, true);
    assert.equal(result.sessionRole, 'consumer');
    assert.equal(result.apiOriginMatch, true);
    assert.equal(result.directApiLoginProbe, DIRECT_API_LOGIN_PROBE_RESULT);
    assert.equal(calls[0].init.redirect, 'manual');
    assert.equal(calls[1].init.redirect, 'manual');
    assert.equal(calls[2].init.redirect, 'manual');
    assert.equal(calls[3].init.redirect, 'manual');
    assert.equal(calls[3].init.method, 'POST');
    assert.equal(calls.some(({ url }) => url.endsWith('/auth/login')), false);
    assert.deepEqual(result.callback.cookieNames, ['__Secure-authjs.session-token']);
    for (const secret of Object.values(secrets)) assert.doesNotMatch(serialized, new RegExp(secret));
    assert.doesNotMatch(serialized, /accessToken|refreshToken/);
  });
});

describe('callback 분류 fail-closed 계약', () => {
  it('Auth.js CredentialsSignin을 credentials 거부로 분류한다', () => {
    assert.equal(
      extractSafeAuthErrorCode(
        `${TARGET_URL}/login?error=CredentialsSignin&code=credentials&secret=must-not-print`,
      ),
      'CredentialsSignin',
    );
    assert.equal(
      classifyCallback({
        status: 302,
        location: { origin: TARGET_URL, path: '/login' },
        callbackUrl: TARGET_URL,
        errorCode: 'CredentialsSignin',
        sessionCookiePresent: false,
      }),
      CALLBACK_CLASSIFICATIONS.CREDENTIALS_REJECTED,
    );
  });

  it('예상 callback redirect와 session cookie를 세션 발급으로 분류한다', () => {
    assert.equal(
      classifyCallback({
        status: 302,
        location: { origin: TARGET_URL, path: '/' },
        callbackUrl: TARGET_URL,
        errorCode: null,
        sessionCookiePresent: true,
      }),
      CALLBACK_CLASSIFICATIONS.SESSION_ISSUED,
    );
  });

  it('credentials를 수락했지만 session cookie가 없으면 별도 분류한다', () => {
    assert.equal(
      classifyCallback({
        status: 302,
        location: { origin: TARGET_URL, path: '/' },
        callbackUrl: TARGET_URL,
        errorCode: null,
        sessionCookiePresent: false,
      }),
      CALLBACK_CLASSIFICATIONS.SUCCESS_WITHOUT_SESSION_COOKIE,
    );
  });

  it('예상하지 않은 redirect와 malformed response를 fail-closed로 분류한다', () => {
    assert.equal(
      classifyCallback({
        status: 302,
        location: { origin: 'https://other.example.test', path: '/' },
        callbackUrl: TARGET_URL,
        errorCode: null,
        sessionCookiePresent: true,
      }),
      CALLBACK_CLASSIFICATIONS.UNEXPECTED_REDIRECT,
    );
    assert.equal(
      classifyCallback({
        status: '302',
        location: null,
        callbackUrl: TARGET_URL,
        errorCode: null,
        sessionCookiePresent: false,
      }),
      CALLBACK_CLASSIFICATIONS.HTTP_FAILURE,
    );
  });
});

describe('exact SHA·Evidence V2·API origin 계약', () => {
  it('expected SHA가 없거나 애플리케이션 SHA와 다르면 거부한다', () => {
    assert.throws(() => validateExactV2Evidence(validEvidence(), undefined), {
      code: 'EXPECTED_SHA_REQUIRED',
    });
    assert.throws(() => validateExactV2Evidence(validEvidence(), OTHER_SHA), {
      code: 'EXPECTED_SHA_MISMATCH',
    });
  });

  it('exact V2 evidence가 ready가 아니면 거부한다', () => {
    assert.throws(() => validateExactV2Evidence({ ...validEvidence(), ready: false }, APPLICATION_SHA), {
      code: 'EXACT_V2_EVIDENCE_NOT_READY',
    });
    assert.throws(
      () => validateExactV2Evidence(validEvidence({ apps: [] }), APPLICATION_SHA),
      { code: 'EXACT_V2_EVIDENCE_CONSUMER_MISMATCH' },
    );
  });

  it('Consumer exact deployment URL은 Evidence V2에서만 가져온다', () => {
    assert.deepEqual(validateExactV2Evidence(validEvidence(), APPLICATION_SHA), { targetUrl: TARGET_URL });
    assert.throws(
      () =>
        validateExactV2Evidence(
          validEvidence({
            apps: [
              {
                ...validEvidence().apps[0],
                deploymentId: 'dpl_other',
              },
            ],
          }),
          APPLICATION_SHA,
        ),
      { code: 'EXACT_V2_EVIDENCE_CONSUMER_MISMATCH' },
    );
  });

  it('public build에서 expected API origin이 보이면 일치로 판정한다', () => {
    const result = classifyApiOriginEvidence([
      `const API = ${JSON.stringify(EXPECTED_API_ORIGIN)}; fetch(API + '/auth/login')`,
    ]);
    assert.deepEqual(result, { apiOriginMatch: true, result: 'API_ORIGIN_MATCH' });
  });

  it('public build의 단일 다른 API origin은 mismatch로 판정한다', () => {
    const result = classifyApiOriginEvidence([
      `const API = 'https://api-other.example.test'; fetch(API + '/auth/login')`,
    ]);
    assert.deepEqual(result, {
      apiOriginMatch: false,
      result: 'CONSUMER_API_ORIGIN_MISMATCH',
    });
  });

  it('API origin을 안전하게 증명할 근거가 없으면 not proven을 유지한다', () => {
    assert.deepEqual(classifyApiOriginEvidence([`fetch('/auth/login')`]), {
      apiOriginMatch: false,
      result: 'API_ORIGIN_BINDING_NOT_PROVEN',
    });
  });
});
