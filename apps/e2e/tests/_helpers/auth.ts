/**
 * 옵션 B (헤더 게이팅) 인증 헬퍼.
 *
 * 프로덕션 빌드는 이메일 폼을 노출하지 않으므로 NextAuth Credentials 엔드포인트를
 * 직접 호출해 세션을 발급받는다. x-e2e-test-token 헤더는 playwright.config.ts의
 * extraHTTPHeaders로 자동 주입된다.
 *
 * Auth.js v5(next-auth 5.0.0-beta.31) 기준.
 *
 * 사용 예:
 *   await loginViaCredentials(page, 'https://seller.greenlove.co.kr', email, password)
 *   await page.goto(`${BASE}/orders`)
 */
import type { Page } from '@playwright/test'

export async function loginViaCredentials(
  page: Page,
  base: string,
  email: string,
  password: string,
): Promise<void> {
  const csrfRes = await page.request.get(`${base}/api/auth/csrf`)
  if (!csrfRes.ok()) {
    throw new Error(`csrf fetch failed: ${csrfRes.status()} ${await csrfRes.text()}`)
  }
  const { csrfToken } = await csrfRes.json()

  const res = await page.request.post(`${base}/api/auth/callback/credentials`, {
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
  const body = await res.json().catch(() => ({}) as { url?: string })
  if (body?.url && /[?&]error=/.test(body.url)) {
    throw new Error(`signIn rejected: ${body.url}`)
  }
}
