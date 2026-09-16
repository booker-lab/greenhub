import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';

globalThis.__dirname = resolve(process.cwd(), 'apps/e2e/tests/_helpers');
const { classifyAuthFailure, cookieNamesFromHeaders, isAuthJsSessionCookieName, sanitizeAuthLocation } = await import('./auth.ts');

function evidence(overrides = {}) {
  return {
    callback: {
      status: 200,
      redirected: false,
      location: {
        path: null,
        origin: 'none',
        authjsErrorCode: null,
        authjsErrorCategory: null,
      },
      setCookie: false,
      setCookieNames: [],
    },
    cookieNames: [],
    sessionCookieEmitted: false,
    sessionCookiePersisted: false,
    sessionReadback: { status: 200, outcome: 'INVALID', redirected: false },
    category: null,
    ...overrides,
  };
}

describe('Auth.js 콜백 진단 계약', () => {
  it('Location의 path·origin·Auth.js category만 보존하고 query 값은 버린다', () => {
    const result = sanitizeAuthLocation(
      '/login?error=CredentialsSignin&code=upstream-rejected&token=redacted-query-value',
      'https://consumer-preview.example.test',
    );
    assert.deepEqual(result, {
      path: '/login',
      origin: 'same-origin',
      authjsErrorCode: 'CredentialsSignin',
      authjsErrorCategory: 'upstream-rejected',
    });
    assert.equal(JSON.stringify(result).includes('redacted-query-value'), false);
  });

  it('Set-Cookie는 cookie 이름만 추출한다', () => {
    const result = cookieNamesFromHeaders([
      { name: 'set-cookie', value: 'authjs.session-token=redacted-cookie-value; Path=/; HttpOnly' },
      { name: 'Set-Cookie', value: 'csrf-token=redacted-csrf-value; Path=/' },
      { name: 'content-type', value: 'application/json' },
    ]);
    assert.deepEqual(result, ['authjs.session-token', 'csrf-token']);
    assert.equal(JSON.stringify(result).includes('redacted-cookie-value'), false);
  });

  it('callback·cookie·session evidence로 실패 원인을 분리한다', () => {
    assert.equal(
      classifyAuthFailure(
        evidence({
          callback: {
            status: 302,
            redirected: true,
            location: {
              path: '/login',
              origin: 'same-origin',
              authjsErrorCode: 'CredentialsSignin',
              authjsErrorCategory: 'upstream-rejected',
            },
            setCookie: false,
            setCookieNames: [],
          },
        }),
      ),
      'UPSTREAM_CREDENTIAL_REJECTED',
    );
    assert.equal(
      classifyAuthFailure(
        evidence({
          callback: {
            status: 302,
            redirected: true,
            location: {
              path: '/login',
              origin: 'same-origin',
              authjsErrorCode: 'CredentialsSignin',
              authjsErrorCategory: 'authorize-rejected',
            },
            setCookie: false,
            setCookieNames: [],
          },
        }),
      ),
      'AUTHJS_AUTHORIZE_REJECTED',
    );
    assert.equal(
      classifyAuthFailure(
        evidence({
          callback: {
            status: 302,
            redirected: true,
            location: {
              path: '/login',
              origin: 'same-origin',
              authjsErrorCode: 'CredentialsSignin',
              authjsErrorCategory: 'api-binding-failure',
            },
            setCookie: false,
            setCookieNames: [],
          },
        }),
      ),
      'API_BINDING_FAILURE',
    );
    assert.equal(
      classifyAuthFailure(
        evidence({
          callback: {
            status: 200,
            redirected: false,
            location: { path: '/', origin: 'same-origin', authjsErrorCode: null, authjsErrorCategory: null },
            setCookie: false,
            setCookieNames: [],
          },
        }),
      ),
      'AUTHJS_SESSION_COOKIE_NOT_EMITTED',
    );
    assert.equal(
      classifyAuthFailure(
        evidence({
          callback: {
            status: 302,
            redirected: true,
            location: { path: '/', origin: 'same-origin', authjsErrorCode: null, authjsErrorCategory: null },
            setCookie: true,
            setCookieNames: ['authjs.session-token'],
          },
          sessionCookieEmitted: true,
          sessionCookiePersisted: false,
        }),
      ),
      'COOKIE_EMITTED_BUT_CONTEXT_NOT_PERSISTED',
    );
    assert.equal(
      classifyAuthFailure(
        evidence({
          callback: {
            status: 302,
            redirected: true,
            location: { path: '/', origin: 'same-origin', authjsErrorCode: null, authjsErrorCategory: null },
            setCookie: true,
            setCookieNames: ['authjs.session-token'],
          },
          cookieNames: ['authjs.session-token'],
          sessionCookieEmitted: true,
          sessionCookiePersisted: true,
          sessionReadback: { status: 200, outcome: 'INVALID', redirected: false },
        }),
      ),
      'SESSION_COOKIE_PRESENT_BUT_SESSION_INVALID',
    );
  });

  describe('Auth.js session cookie 이름 판정 (단일 owner)', () => {
    it('bare / __Secure- / __Host- / numeric chunk session cookie를 인식한다', () => {
      for (const name of [
        'authjs.session-token',
        'authjs.session-token.0',
        'authjs.session-token.1',
        '__Secure-authjs.session-token',
        '__Secure-authjs.session-token.0',
        '__Secure-authjs.session-token.1',
        '__Host-authjs.session-token',
        '__Host-authjs.session-token.0',
        '__Host-authjs.session-token.1',
      ]) {
        assert.equal(isAuthJsSessionCookieName(name), true, name);
      }
      // cookie jar 수준: chunked secure 이름 하나만 있어도 세션으로 판정한다.
      assert.equal(['__Secure-authjs.session-token.0'].some(isAuthJsSessionCookieName), true);
      assert.equal(['__Host-authjs.session-token.1', 'authjs.csrf-token'].some(isAuthJsSessionCookieName), true);
    });

    it('csrf/callback/substring/non-numeric suffix를 session cookie로 인정하지 않는다', () => {
      for (const name of [
        'authjs.csrf-token',
        '__Secure-authjs.csrf-token',
        '__Host-authjs.csrf-token',
        'authjs.callback-url',
        'authjs.session-tokenx',
        'fooauthjs.session-token',
        '__Secure-authjs.session-token.foo',
      ]) {
        assert.equal(isAuthJsSessionCookieName(name), false, name);
      }
      assert.equal(['authjs.csrf-token', '__Secure-authjs.csrf-token'].some(isAuthJsSessionCookieName), false);
    });

    it('chunked secure Set-Cookie evidence에서도 value를 노출하지 않는다', () => {
      const result = cookieNamesFromHeaders([
        { name: 'set-cookie', value: '__Secure-authjs.session-token.0=redacted-chunked-value; Path=/; HttpOnly; Secure' },
        { name: 'set-cookie', value: '__Host-authjs.session-token.1=redacted-host-value; Path=/; HttpOnly; Secure' },
      ]);
      assert.deepEqual(result, ['__Host-authjs.session-token.1', '__Secure-authjs.session-token.0']);
      assert.equal(result.some(isAuthJsSessionCookieName), true);
      assert.equal(JSON.stringify(result).includes('redacted-chunked-value'), false);
      assert.equal(JSON.stringify(result).includes('redacted-host-value'), false);
    });

    it('global-setup은 별도 matcher를 소유하지 않고 단일 owner를 사용한다', () => {
      const source = readFileSync(resolve(process.cwd(), 'apps/e2e/global-setup.ts'), 'utf8');
      assert.ok(source.includes('isAuthJsSessionCookieName'));
      const nonCommentOwners = source
        .split('\n')
        .filter((line) => line.includes('authjs.session-token') && !line.trim().startsWith('//'));
      assert.deepEqual(nonCommentOwners, []);
    });
  });

  describe('canonical verbose consumer reject stages (g1/g2/g3) compatibility', () => {
    const BASE = 'https://consumer-preview.example.test';
    const CANONICAL_VERBOSE_FAMILY = [
      'authorize-rejected__g1-secret-missing',
      'authorize-rejected__g2-secret-mismatch',
      'authorize-rejected__g3-credential-admission-rejected',
    ];

    function classifiedCategoryForCode(code) {
      return classifyAuthFailure(
        evidence({
          callback: {
            status: 302,
            redirected: true,
            location: {
              path: '/login',
              origin: 'same-origin',
              authjsErrorCode: 'CredentialsSignin',
              authjsErrorCategory: code,
            },
            setCookie: false,
            setCookieNames: [],
          },
        }),
      );
    }

    function classifiedWithoutFallback(code) {
      return classifyAuthFailure(
        evidence({
          callback: {
            status: 302,
            redirected: true,
            location: {
              path: '/login',
              origin: 'same-origin',
              authjsErrorCode: null,
              authjsErrorCategory: code,
            },
            setCookie: false,
            setCookieNames: [],
          },
        }),
      );
    }

    it('plain legacy authorize-rejected를 그대로 지원한다', () => {
      const sanitized = sanitizeAuthLocation('/login?error=CredentialsSignin&code=authorize-rejected', BASE);
      assert.equal(sanitized.authjsErrorCategory, 'authorize-rejected');
      assert.equal(classifiedCategoryForCode('authorize-rejected'), 'AUTHJS_AUTHORIZE_REJECTED');
      assert.equal(classifiedWithoutFallback('authorize-rejected'), 'AUTHJS_AUTHORIZE_REJECTED');
      assert.equal(
        classifiedCategoryForCode(
          sanitizeAuthLocation('/login?error=CredentialsSignin&code=authorize-rejected', BASE).authjsErrorCategory,
        ),
        'AUTHJS_AUTHORIZE_REJECTED',
      );
      assert.equal(
        classifiedWithoutFallback(
          sanitizeAuthLocation('/login?code=authorize-rejected', BASE).authjsErrorCategory,
        ),
        'AUTHJS_AUTHORIZE_REJECTED',
      );
    });

    it('canonical verbose g1/g2/g3를 safe code verbatim으로 인정하고 fallback 없이도 AUTHJS_AUTHORIZE_REJECTED로 분류한다', () => {
      for (const code of CANONICAL_VERBOSE_FAMILY) {
        const sanitized = sanitizeAuthLocation(`/login?error=CredentialsSignin&code=${code}`, BASE);
        assert.equal(sanitized.authjsErrorCategory, code, code);
        assert.equal(JSON.stringify(sanitized).includes(code), true);
        assert.equal(classifiedCategoryForCode(code), 'AUTHJS_AUTHORIZE_REJECTED', code);
        assert.equal(classifiedCategoryForCode(sanitized.authjsErrorCategory), 'AUTHJS_AUTHORIZE_REJECTED', code);
        assert.equal(classifiedWithoutFallback(code), 'AUTHJS_AUTHORIZE_REJECTED', code);
        assert.equal(classifiedWithoutFallback(sanitized.authjsErrorCategory), 'AUTHJS_AUTHORIZE_REJECTED', code);
      }
    });

    it('malformed/phantom은 unknown으로 fail-closed하고 direct family로 분류하지 않는다', () => {
      const malformed = [
        'authorize-rejected__g1',
        'authorize-rejected__g2',
        'authorize-rejected__g3',
        'authorize-rejected__g4',
        'authorize-rejected__g1-extra',
        'authorize-rejected__G1',
        'authorize-rejected__g1/',
        '/authorize-rejected__g1-secret-missing',
        'authorize-rejected__g1-secret-missing/extra',
        'xauthorize-rejected__g1-secret-missing',
        'authorize-rejected__g1-secret-missingx',
        'prefix-authorize-rejected',
        'authorize-rejected-suffix',
        'authorize-rejected__secret',
        'super-secret-value-123',
      ];
      for (const code of malformed) {
        const sanitized = sanitizeAuthLocation(`/login?error=CredentialsSignin&code=${encodeURIComponent(code)}`, BASE);
        assert.equal(sanitized.authjsErrorCategory, 'unknown', code);
        assert.equal(JSON.stringify(sanitized).includes(code), false, code);
        assert.notEqual(classifiedWithoutFallback(sanitized.authjsErrorCategory), 'AUTHJS_AUTHORIZE_REJECTED', code);
        assert.notEqual(classifiedWithoutFallback(code), 'AUTHJS_AUTHORIZE_REJECTED', code);
      }
    });

    it('upstream-rejected / api-binding-failure 분류를 유지한다', () => {
      const upstream = sanitizeAuthLocation('/login?error=CredentialsSignin&code=upstream-rejected', BASE);
      assert.equal(upstream.authjsErrorCategory, 'upstream-rejected');
      assert.equal(classifiedCategoryForCode('upstream-rejected'), 'UPSTREAM_CREDENTIAL_REJECTED');

      const binding = sanitizeAuthLocation('/login?error=CredentialsSignin&code=api-binding-failure', BASE);
      assert.equal(binding.authjsErrorCategory, 'api-binding-failure');
      assert.equal(classifiedCategoryForCode('api-binding-failure'), 'API_BINDING_FAILURE');
    });

    it('CredentialsSignin / CallbackRouteError fallback을 유지한다', () => {
      for (const errorCode of ['CredentialsSignin', 'CallbackRouteError']) {
        assert.equal(
          classifyAuthFailure(
            evidence({
              callback: {
                status: 302,
                redirected: true,
                location: {
                  path: '/login',
                  origin: 'same-origin',
                  authjsErrorCode: errorCode,
                  authjsErrorCategory: null,
                },
                setCookie: false,
                setCookieNames: [],
              },
            }),
          ),
          'AUTHJS_AUTHORIZE_REJECTED',
          errorCode,
        );
      }
    });
  });
});
