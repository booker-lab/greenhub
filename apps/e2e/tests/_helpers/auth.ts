/**
 * 옵션 B (헤더 게이팅) 인증 헬퍼.
 *
 * 프로덕션 빌드는 이메일 폼을 노출하지 않으므로 NextAuth Credentials 엔드포인트를
 * 직접 호출해 세션을 발급받는다. x-e2e-test-token 헤더는 NextAuth credentials POST
 * 한 번에만 필요하므로 이 호출에만 명시적으로 주입한다 (전역 extraHTTPHeaders는
 * Firebase 등 third-party API에서 CORS preflight 차단 문제를 유발해 사용 안 함).
 *
 * Auth.js v5(next-auth 5.0.0-beta.31) 기준.
 *
 * 사용 예:
 *   await loginViaCredentials(page, 'https://seller.greenlove.co.kr', email, password)
 *   await page.goto(`${BASE}/orders`)
 */
import { resolve } from 'path'
import type { APIResponse, Page } from '@playwright/test'

export const AUTH_FAILURE_CATEGORIES = [
  'UPSTREAM_CREDENTIAL_REJECTED',
  'AUTHJS_AUTHORIZE_REJECTED',
  'AUTHJS_SESSION_COOKIE_NOT_EMITTED',
  'COOKIE_EMITTED_BUT_CONTEXT_NOT_PERSISTED',
  'SESSION_COOKIE_PRESENT_BUT_SESSION_INVALID',
  'API_BINDING_FAILURE',
  'UNKNOWN_AFTER_OBSERVABILITY',
] as const

export type AuthFailureCategory = (typeof AUTH_FAILURE_CATEGORIES)[number]

type SafeLocationEvidence = {
  path: string | null
  origin: 'same-origin' | 'cross-origin' | 'invalid' | 'none'
  authjsErrorCode: string | null
  authjsErrorCategory: string | null
}

export type AuthDiagnosticEvidence = {
  callback: {
    status: number | null
    redirected: boolean
    location: SafeLocationEvidence
    setCookie: boolean
    setCookieNames: string[]
  }
  cookieNames: string[]
  sessionCookieEmitted: boolean
  sessionCookiePersisted: boolean
  sessionReadback: {
    status: number | null
    outcome: 'VALID' | 'INVALID' | 'UNAVAILABLE'
    redirected: boolean
  }
  category: AuthFailureCategory | null
}

const SAFE_AUTH_CODES = new Set([
  'CredentialsSignin',
  'CallbackRouteError',
  'AccessDenied',
  'MissingCSRF',
  'authorize-rejected',
  'upstream-rejected',
  'api-binding-failure',
])

function safeAuthCode(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  return SAFE_AUTH_CODES.has(value) ? value : 'unknown'
}

export function sanitizeAuthLocation(location: unknown, base: string): SafeLocationEvidence {
  if (typeof location !== 'string' || !location.trim()) {
    return {
      path: null,
      origin: 'none',
      authjsErrorCode: null,
      authjsErrorCategory: null,
    }
  }

  try {
    const baseUrl = new URL(base)
    const url = new URL(location, baseUrl)
    return {
      path: url.pathname || '/',
      origin: url.origin === baseUrl.origin ? 'same-origin' : 'cross-origin',
      authjsErrorCode: safeAuthCode(url.searchParams.get('error')),
      authjsErrorCategory: safeAuthCode(url.searchParams.get('code')),
    }
  } catch {
    return {
      path: null,
      origin: 'invalid',
      authjsErrorCode: null,
      authjsErrorCategory: null,
    }
  }
}

export function cookieNamesFromHeaders(
  headers: Array<{ name: string; value: string }>,
): string[] {
  return [...new Set(
    headers
      .filter(({ name }) => name.toLowerCase() === 'set-cookie')
      .map(({ value }) => value.split(';', 1)[0]?.split('=', 1)[0]?.trim())
      .filter((name): name is string => Boolean(name)),
  )].sort()
}

function hasSessionCookie(names: string[]): boolean {
  return names.some((name) => /(?:^|\.)authjs\.session-token(?:\.|$)/.test(name))
}

export function classifyAuthFailure(evidence: AuthDiagnosticEvidence): AuthFailureCategory | null {
  const { callback, sessionCookieEmitted, sessionCookiePersisted, sessionReadback } = evidence
  const errorCode = callback.location.authjsErrorCode
  const errorCategory = callback.location.authjsErrorCategory

  if (errorCategory === 'upstream-rejected') return 'UPSTREAM_CREDENTIAL_REJECTED'
  if (errorCategory === 'authorize-rejected') return 'AUTHJS_AUTHORIZE_REJECTED'
  if (errorCategory === 'api-binding-failure') return 'API_BINDING_FAILURE'
  if (callback.status !== null && callback.status >= 500) return 'API_BINDING_FAILURE'
  if (sessionCookieEmitted && !sessionCookiePersisted) {
    return 'COOKIE_EMITTED_BUT_CONTEXT_NOT_PERSISTED'
  }
  if (sessionCookiePersisted && sessionReadback.outcome === 'INVALID') {
    return 'SESSION_COOKIE_PRESENT_BUT_SESSION_INVALID'
  }
  if (!sessionCookieEmitted) {
    if (errorCode === 'CredentialsSignin' || errorCode === 'CallbackRouteError') {
      return 'AUTHJS_AUTHORIZE_REJECTED'
    }
    if (callback.status !== null && callback.status >= 200 && callback.status < 400) {
      return 'AUTHJS_SESSION_COOKIE_NOT_EMITTED'
    }
  }
  if (sessionReadback.outcome === 'UNAVAILABLE' && !sessionCookiePersisted) {
    return 'UNKNOWN_AFTER_OBSERVABILITY'
  }
  return null
}

function parseJsonBody(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function readSameContextSession(page: Page, base: string): Promise<AuthDiagnosticEvidence['sessionReadback']> {
  try {
    const response = await page.request.get(`${base}/api/auth/session`, { maxRedirects: 0 })
    const redirected = response.status() >= 300 && response.status() < 400
    if (redirected || !response.ok()) {
      return { status: response.status(), outcome: 'UNAVAILABLE', redirected }
    }
    const body = parseJsonBody(await response.text())
    const user = body.user
    const userRecord =
      user && typeof user === 'object' && !Array.isArray(user)
        ? (user as { accessToken?: unknown })
        : null
    const valid =
      typeof userRecord?.accessToken === 'string' && userRecord.accessToken.length > 0
    return {
      status: response.status(),
      outcome: valid ? 'VALID' : 'INVALID',
      redirected: false,
    }
  } catch {
    return { status: null, outcome: 'UNAVAILABLE', redirected: false }
  }
}

function diagnosticError(evidence: AuthDiagnosticEvidence): Error {
  return new Error(`인증 진단 실패: ${JSON.stringify(evidence)}`)
}

/**
 * globalSetup이 발급하는 storageState 파일 경로 (SSOT).
 *  - BYPASS_STATE_PATH — Vercel SSO 우회 쿠키만. 미인증 spec 기본 상태.
 *  - AUTH_STATE_PATH   — 우회 + seller·consumer 세션 쿠키. 인증 spec이
 *    test.use({ storageState: AUTH_STATE_PATH })로 재사용한다 (#CL-23).
 */
export const BYPASS_STATE_PATH = resolve(__dirname, '../../.bypass-state.json')
export const AUTH_STATE_PATH = resolve(__dirname, '../../.auth-state.json')
// admin은 seller와 같은 도메인(SELLER_BASE)을 공유 → 같은 컨텍스트에 누적하면
// authjs.session-token 쿠키가 1슬롯뿐이라 마지막 로그인만 남고 충돌한다.
// admin 전용 컨텍스트에서 별도 발급해 seller 세션과 격리한다.
export const ADMIN_STATE_PATH = resolve(__dirname, '../../.admin-state.json')
export const ROUND_DIRECT_STATE_PATHS = {
  chromium: resolve(__dirname, '../../.round-direct-chromium-state.json'),
  mobile: resolve(__dirname, '../../.round-direct-mobile-state.json'),
} as const

type CredentialHeader = {
  name: string
  value: string
}

export async function loginViaCredentials(
  page: Page,
  base: string,
  email: string,
  password: string,
  credentialHeader?: CredentialHeader,
): Promise<AuthDiagnosticEvidence> {
  const defaultSecret = process.env['E2E_TEST_SECRET']
  if (!credentialHeader && !defaultSecret) {
    throw new Error('인증 진단 실패: category=AUTHJS_AUTHORIZE_REJECTED')
  }
  const headers = credentialHeader
    ? { [credentialHeader.name]: credentialHeader.value }
    : { 'x-e2e-test-token': defaultSecret as string }

  const csrfRes = await page.request.get(`${base}/api/auth/csrf`, {
    headers,
    maxRedirects: 0,
  })
  if (!csrfRes.ok()) {
    throw new Error(`인증 진단 실패: category=API_BINDING_FAILURE csrfStatus=${csrfRes.status()}`)
  }
  const csrfBody = parseJsonBody(await csrfRes.text())
  const csrfToken = csrfBody.csrfToken
  if (typeof csrfToken !== 'string' || !csrfToken) {
    throw new Error('인증 진단 실패: category=API_BINDING_FAILURE csrfTokenMissing=true')
  }

  let response: APIResponse
  try {
    response = await page.request.post(`${base}/api/auth/callback/credentials`, {
      headers,
      maxRedirects: 0,
      form: {
        email,
        password,
        csrfToken,
        callbackUrl: base,
        json: 'true',
      },
    })
  } catch {
    throw new Error('인증 진단 실패: category=API_BINDING_FAILURE callbackTransport=failed')
  }

  const callbackHeaders = response.headersArray()
  const callbackBody = parseJsonBody(await response.text())
  const locationHeader = callbackHeaders.find(
    ({ name }) => name.toLowerCase() === 'location',
  )?.value
  const location = sanitizeAuthLocation(
    locationHeader ?? (typeof callbackBody.url === 'string' ? callbackBody.url : null),
    base,
  )
  const setCookieNames = cookieNamesFromHeaders(callbackHeaders)
  const cookies = await page.context().cookies(base)
  const cookieNames = cookies.map(({ name }) => name).sort()
  const evidence: AuthDiagnosticEvidence = {
    callback: {
      status: response.status(),
      redirected: response.status() >= 300 && response.status() < 400,
      location,
      setCookie: setCookieNames.length > 0,
      setCookieNames,
    },
    cookieNames,
    sessionCookieEmitted: hasSessionCookie(setCookieNames),
    sessionCookiePersisted: hasSessionCookie(cookieNames),
    sessionReadback: await readSameContextSession(page, base),
    category: null,
  }
  evidence.category = classifyAuthFailure(evidence)

  if (evidence.category) throw diagnosticError(evidence)
  return evidence
}
