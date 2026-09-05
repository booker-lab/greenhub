import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';

globalThis.__dirname = resolve(process.cwd(), 'apps/e2e/tests/_helpers');
const { classifyAuthFailure, cookieNamesFromHeaders, sanitizeAuthLocation } = await import('./auth.ts');

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
});
