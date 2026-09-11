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
});
