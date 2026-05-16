/**
 * Vercel SSO 우회 쿠키 + 인증 세션 쿠키 발급 (globalSetup).
 *
 * 두 개의 storageState 파일을 발급한다:
 *  - .bypass-state.json — Vercel Deployment Protection 우회 쿠키(_vercel_jwt)만.
 *    미인증 동작을 검증하는 spec(리디렉트 등)의 기본 storageState.
 *  - .auth-state.json — 위 우회 쿠키 + seller·consumer 세션 쿠키 누적.
 *    인증이 필요한 spec이 test.use({ storageState })로 재사용한다 (#CL-23).
 *
 * #CL-23: 세션 쿠키를 spec마다 발급하면 Railway /auth/login 호출이 N×spec으로
 * 누적돼 인증 race(set-cookie 누락)가 시간 누적으로 증폭된다. globalSetup에서
 * 풀런 시작 시점에 1회만 로그인해 인증 호출을 N→1로 줄인다.
 *
 * globalSetup이 풀런의 단일 진입점이므로, 여기서 로그인이 한 번 race에 걸리면
 * 풀런 전체가 0건 실행으로 중단된다. set-cookie race는 fresh 상태에서도 기저
 * 발생률이 있으므로(#CL-23 T3 관측), loginViaCredentials의 throw를 제한적으로
 * 재시도(LOGIN_MAX_ATTEMPTS회)해 흡수한다. 재시도를 모두 소진하면 throw를
 * 그대로 전파해 fail-fast한다 — N→1 목표는 유지되며(최대 3회 시도) race가
 * 끝내 가시화된다.
 *
 * 헤더(x-vercel-protection-bypass)를 use.extraHTTPHeaders로 전역 주입하지
 * 않는 이유: 앱의 Firebase 호출에도 커스텀 헤더가 따라가 CORS preflight가
 * 차단된다. 쿠키는 해당 vercel.app 도메인에만 전송되므로 third-party 호출에
 * 영향이 없다 — storageState(쿠키 누적)가 충돌 없이 통합되는 근거이기도 하다.
 *
 * driver는 Credentials provider가 없어(Kakao OAuth 전용, #CL-25) 인증 세션
 * 발급 대상에서 제외한다.
 */
import { chromium, type Page } from '@playwright/test'
import { config as loadEnv } from 'dotenv'
import { resolve } from 'path'
import {
  AUTH_STATE_PATH,
  BYPASS_STATE_PATH,
  loginViaCredentials,
} from './tests/_helpers/auth'

loadEnv({ path: resolve(__dirname, '.env') })

const BYPASS_TARGETS = [
  { name: 'SELLER', base: process.env['SELLER_BASE'], secret: process.env['SELLER_BYPASS_SECRET'] },
  { name: 'CONSUMER', base: process.env['CONSUMER_BASE'], secret: process.env['CONSUMER_BYPASS_SECRET'] },
  { name: 'DRIVER', base: process.env['DRIVER_BASE'], secret: process.env['DRIVER_BYPASS_SECRET'] },
]

// globalSetup 로그인 race 흡수용 재시도 횟수·간격
const LOGIN_MAX_ATTEMPTS = 3
const LOGIN_RETRY_DELAY_MS = 2_000

// driver 제외 — Credentials provider 부재(Kakao 전용, #CL-25)
const CREDENTIAL_TARGETS = [
  {
    name: 'SELLER',
    base: process.env['SELLER_BASE'],
    email: process.env['TEST_SELLER_EMAIL'],
    password: process.env['TEST_SELLER_PASSWORD'],
  },
  {
    name: 'CONSUMER',
    base: process.env['CONSUMER_BASE'],
    email: process.env['TEST_CONSUMER_EMAIL'],
    password: process.env['TEST_CONSUMER_PASSWORD'],
  },
]

/**
 * loginViaCredentials를 set-cookie race에 한해 제한적으로 재시도한다.
 * 마지막 시도까지 실패하면 마지막 에러를 그대로 throw해 fail-fast한다.
 */
async function loginWithRetry(
  page: Page,
  base: string,
  email: string,
  password: string,
  name: string,
): Promise<void> {
  for (let attempt = 1; attempt <= LOGIN_MAX_ATTEMPTS; attempt++) {
    try {
      await loginViaCredentials(page, base, email, password)
      if (attempt > 1) {
        console.warn(`globalSetup: ${name} 로그인 ${attempt}회차 성공`)
      }
      return
    } catch (err) {
      if (attempt === LOGIN_MAX_ATTEMPTS) throw err
      console.warn(
        `globalSetup: ${name} 로그인 ${attempt}/${LOGIN_MAX_ATTEMPTS}회차 실패 — 재시도\n  ${String(err)}`,
      )
      await page.waitForTimeout(LOGIN_RETRY_DELAY_MS)
    }
  }
}

export default async function globalSetup(): Promise<void> {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  // 1. Vercel SSO 우회 쿠키 발급 — Preview(.vercel.app) 도메인만 대상.
  //    credential 로그인이 /api/auth/* 를 호출하기 전에 먼저 발급돼야 한다
  //    (우회 쿠키 없이는 SSO 401 페이지가 응답된다).
  for (const { name, base, secret } of BYPASS_TARGETS) {
    if (!base) throw new Error(`globalSetup: ${name}_BASE 미설정`)
    // production 도메인은 Deployment Protection 대상이 아니므로 우회 불필요
    if (!base.includes('.vercel.app')) continue
    if (!secret) {
      throw new Error(`globalSetup: ${name}_BYPASS_SECRET 미설정 — Preview SSO 우회 불가`)
    }
    const url = `${base}/?x-vercel-protection-bypass=${secret}&x-vercel-set-bypass-cookie=true`
    await page.goto(url, { waitUntil: 'domcontentloaded' })
  }

  // 우회 쿠키만 담긴 상태 저장 — 미인증/SSO 우회 spec의 기본 storageState
  await context.storageState({ path: BYPASS_STATE_PATH })

  // 2. seller·consumer 세션 쿠키 발급 — 같은 컨텍스트에 누적.
  //    쿠키는 도메인 스코프이므로 우회 쿠키·앱별 세션이 충돌 없이 공존한다.
  for (const { name, base, email, password } of CREDENTIAL_TARGETS) {
    if (!base) throw new Error(`globalSetup: ${name}_BASE 미설정`)
    if (!email || !password) {
      // 시크릿 미설정 환경 — 세션 쿠키만 생략한다. 해당 인증 spec은 자체
      // test.skip(skipAuth) 로 건너뛰므로 .auth-state.json 자체는 발급한다.
      console.warn(
        `globalSetup: ${name} 인증 시크릿(TEST_${name}_EMAIL/PASSWORD) 미설정 — ` +
          `세션 쿠키 생략 (해당 인증 spec은 test.skip 처리됨)`,
      )
      continue
    }
    await loginWithRetry(page, base, email, password, name)
  }

  // 우회 + seller·consumer 세션 쿠키 누적 상태 저장 — 인증 spec의 storageState
  await context.storageState({ path: AUTH_STATE_PATH })

  await browser.close()
}
