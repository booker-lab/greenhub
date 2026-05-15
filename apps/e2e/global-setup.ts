/**
 * Vercel Deployment Protection 우회 쿠키 발급 (globalSetup).
 *
 * Preview 배포는 Vercel Authentication(SSO)로 보호되므로 e2e가 그대로
 * 접근하면 401(SSO 로그인 페이지)을 받는다. Protection Bypass for Automation
 * 시크릿을 쿼리 파라미터로 1회 navigate 하면 Vercel edge가 도메인 바인딩된
 * `_vercel_jwt` 쿠키를 발급한다. 이 쿠키를 storageState로 저장해 모든 spec이
 * 재사용하도록 한다 (#CL-21).
 *
 * 헤더(x-vercel-protection-bypass)를 use.extraHTTPHeaders로 전역 주입하지
 * 않는 이유: 앱의 Firebase 호출에도 커스텀 헤더가 따라가 CORS preflight가
 * 차단된다 (옵션 B x-e2e-test-token 헤더와 동일한 사각지대). 쿠키는 해당
 * vercel.app 도메인에만 전송되므로 third-party 호출에 영향이 없다.
 */
import { chromium } from '@playwright/test'
import { config as loadEnv } from 'dotenv'
import { resolve } from 'path'

loadEnv({ path: resolve(__dirname, '.env') })

export const BYPASS_STATE_PATH = resolve(__dirname, '.bypass-state.json')

const TARGETS = [
  { name: 'SELLER', base: process.env['SELLER_BASE'], secret: process.env['SELLER_BYPASS_SECRET'] },
  { name: 'CONSUMER', base: process.env['CONSUMER_BASE'], secret: process.env['CONSUMER_BYPASS_SECRET'] },
  { name: 'DRIVER', base: process.env['DRIVER_BASE'], secret: process.env['DRIVER_BYPASS_SECRET'] },
]

export default async function globalSetup(): Promise<void> {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  for (const { name, base, secret } of TARGETS) {
    if (!base) throw new Error(`globalSetup: ${name}_BASE 미설정`)
    // production 도메인은 Deployment Protection 대상이 아니므로 우회 불필요
    if (!base.includes('.vercel.app')) continue
    if (!secret) {
      throw new Error(`globalSetup: ${name}_BYPASS_SECRET 미설정 — Preview SSO 우회 불가`)
    }
    const url = `${base}/?x-vercel-protection-bypass=${secret}&x-vercel-set-bypass-cookie=true`
    await page.goto(url, { waitUntil: 'domcontentloaded' })
  }

  await context.storageState({ path: BYPASS_STATE_PATH })
  await browser.close()
}
