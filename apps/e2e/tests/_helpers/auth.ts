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
import type { Page } from '@playwright/test'

/**
 * globalSetup이 발급하는 storageState 파일 경로 (SSOT).
 *  - BYPASS_STATE_PATH — Vercel SSO 우회 쿠키만. 미인증 spec 기본 상태.
 *  - AUTH_STATE_PATH   — 우회 + seller·consumer 세션 쿠키. 인증 spec이
 *    test.use({ storageState: AUTH_STATE_PATH })로 재사용한다 (#CL-23).
 */
export const BYPASS_STATE_PATH = resolve(__dirname, '../../.bypass-state.json')
export const AUTH_STATE_PATH = resolve(__dirname, '../../.auth-state.json')

export async function loginViaCredentials(
  page: Page,
  base: string,
  email: string,
  password: string,
): Promise<void> {
  const secret = process.env['E2E_TEST_SECRET']
  if (!secret) {
    throw new Error('E2E_TEST_SECRET env not set — required for 옵션 B 헤더 게이팅')
  }
  const headers = { 'x-e2e-test-token': secret }

  const csrfRes = await page.request.get(`${base}/api/auth/csrf`, { headers })
  if (!csrfRes.ok()) {
    throw new Error(`csrf fetch failed: ${csrfRes.status()} ${await csrfRes.text()}`)
  }
  const { csrfToken } = await csrfRes.json()

  const res = await page.request.post(`${base}/api/auth/callback/credentials`, {
    headers,
    form: {
      email,
      password,
      csrfToken,
      callbackUrl: base,
      json: 'true',
    },
  })
  if (!res.ok()) {
    throw new Error(`signIn failed: ${res.status()} ${await res.text()}`)
  }
  const body = (await res.json().catch(() => ({}))) as { url?: string }
  if (body?.url && /[?&]error=/.test(body.url)) {
    throw new Error(`signIn rejected: ${body.url}`)
  }

  // 세션 쿠키 발급 검증 — credentials POST 응답의 set-cookie가 BrowserContext의
  // cookie jar에 들어갔는지 직접 확인. Vercel/Railway 일시 부하 상황에서 set-cookie
  // 없는 200 응답이 관측되며(세션24 진단), 그대로 page.goto()가 진행되면 카카오
  // 로그인 페이지로 리다이렉트되어 텍스트 셀렉터 매칭이 실패한다. 명시적 throw로
  // playwright test-level retry(retries: 1)가 정상 동작하도록 가시화한다.
  const cookies = await page.context().cookies(base)
  const sessionCookie = cookies.find((c) => /authjs\.session-token/.test(c.name))
  if (!sessionCookie) {
    const setCookieCount = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie').length
    throw new Error(
      `session cookie not in context after signIn — ` +
        `set-cookie count=${setCookieCount}, ` +
        `body.url=${body?.url ?? 'null'}, ` +
        `cookie names=[${cookies.map((c) => c.name).join(', ')}]`,
    )
  }
}
