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
  ADMIN_STATE_PATH,
  AUTH_STATE_PATH,
  BYPASS_STATE_PATH,
  loginViaCredentials,
  ROUND_DIRECT_STATE_PATHS,
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
type CredentialHeader = { name: string; value: string }

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

// admin은 어드민 화면이 셀러앱 내 /admin/* 경로라 SELLER_BASE를 공유한다.
// seller와 같은 도메인 → authjs.session-token 쿠키 슬롯이 1개뿐이라 같은
// 컨텍스트에 누적하면 충돌한다. admin 전용 컨텍스트에서 우회 쿠키 + admin
// 세션만 담아 .admin-state.json으로 격리 발급한다(어드민 spec이 재사용).
const ADMIN_TARGET = {
  name: 'ADMIN',
  base: process.env['SELLER_BASE'],
  bypassSecret: process.env['SELLER_BYPASS_SECRET'],
  email: process.env['TEST_ADMIN_EMAIL'],
  password: process.env['TEST_ADMIN_PASSWORD'],
}

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
  credentialHeader?: CredentialHeader,
): Promise<void> {
  for (let attempt = 1; attempt <= LOGIN_MAX_ATTEMPTS; attempt++) {
    try {
      await loginViaCredentials(page, base, email, password, credentialHeader)
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

async function verifyRoleSession(page: Page, base: string, expectedRole: string): Promise<void> {
  const response = await page.request.get(`${base}/api/auth/session`)
  if (!response.ok()) {
    throw new Error(`${expectedRole} 세션 확인 응답 실패: ${response.status()}`)
  }
  const session = (await response.json()) as {
    expires?: string
    user?: { role?: string; accessToken?: string }
  }
  if (session.user?.role !== expectedRole || !session.user.accessToken) {
    throw new Error(`${expectedRole} 세션 역할 또는 accessToken 검증 실패`)
  }
  const expiresAt = Date.parse(session.expires ?? '')
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error(`${expectedRole} 세션 만료 시각 검증 실패`)
  }
  const cookies = await page.context().cookies(base)
  if (!cookies.some(({ name }) => /authjs\.session-token/.test(name))) {
    throw new Error(`${expectedRole} 대상 도메인의 세션 쿠키 검증 실패`)
  }
}

async function createRoundDirectProjectState(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  project: keyof typeof ROUND_DIRECT_STATE_PATHS,
): Promise<void> {
  const suffix = project.toUpperCase()
  const accounts = [
    {
      name: `${project} 소비자`,
      role: 'consumer',
      base: process.env['CONSUMER_BASE'],
      email: process.env[`TEST_CONSUMER_EMAIL_${suffix}`],
      password: process.env[`TEST_CONSUMER_PASSWORD_${suffix}`],
      credentialHeader: undefined,
    },
    {
      name: `${project} 셀러`,
      role: 'seller',
      base: process.env['SELLER_BASE'],
      email: process.env[`TEST_SELLER_EMAIL_${suffix}`],
      password: process.env[`TEST_SELLER_PASSWORD_${suffix}`],
      credentialHeader: undefined,
    },
    {
      name: `${project} 드라이버`,
      role: 'driver',
      base: process.env['DRIVER_BASE'],
      email: process.env[`TEST_DRIVER_EMAIL_${suffix}`],
      password: process.env[`TEST_DRIVER_PASSWORD_${suffix}`],
      credentialHeader: {
        name: 'x-round-direct-e2e-secret',
        value: process.env['ROUND_DIRECT_E2E_SHARED_SECRET'] ?? '',
      },
    },
  ]
  const missing = accounts.flatMap(({ name, base, email, password }) => {
    const fields = []
    if (!base) fields.push(`${name} base`)
    if (!email) fields.push(`${name} email`)
    if (!password) fields.push(`${name} password`)
    return fields
  })
  if (!process.env['ROUND_DIRECT_E2E_SHARED_SECRET']) {
    missing.push('회차 E2E 공유 secret')
  }
  if (missing.length > 0) {
    throw new Error(`회차 E2E ${project} 인증 입력 누락: ${missing.join(', ')}`)
  }

  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    for (const { name, base, email, password, role, credentialHeader } of accounts) {
      await loginWithRetry(
        page,
        base as string,
        email as string,
        password as string,
        name,
        credentialHeader,
      )
      await verifyRoleSession(page, base as string, role)
    }
    await context.storageState({ path: ROUND_DIRECT_STATE_PATHS[project] })
  } finally {
    await context.close()
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

  // bypass 루프의 마지막 page.goto는 미인증 루트(/)이므로 앱이 클라이언트
  // 사이드로 /login 리다이렉트를 시작한다. 이 in-flight 네비게이션이 남아
  // 있으면 이후 context.storageState() 호출이
  //   "Navigation to X is interrupted by another navigation to X/login"
  // 으로 실패한다(세션36 run 25970814882 — flake 확정). 우회·인증 상태는
  // 모두 도메인 스코프 쿠키이므로 about:blank로 이동해도 손실이 없다.
  // 여기서 한 번 네비게이션을 종료하면 이후 두 storageState() 호출이 모두
  // 안정 상태에서 수행된다 (loginViaCredentials는 page.request만 사용 —
  // 페이지를 네비게이트하지 않음).
  await page.goto('about:blank')

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

  // 3. admin 세션 — seller와 같은 도메인이라 별도 컨텍스트에서 격리 발급.
  //    seller 세션 쿠키가 없는 깨끗한 컨텍스트에 우회 쿠키 + admin 세션만 담는다.
  //    시크릿 미설정 시 빈(.bypass만) 상태로 발급 — 어드민 인증 spec은 test.skip 처리됨.
  const adminCtx = await browser.newContext()
  const adminPage = await adminCtx.newPage()
  if (ADMIN_TARGET.base?.includes('.vercel.app')) {
    if (!ADMIN_TARGET.bypassSecret) {
      throw new Error('globalSetup: SELLER_BYPASS_SECRET 미설정 — admin Preview SSO 우회 불가')
    }
    const url = `${ADMIN_TARGET.base}/?x-vercel-protection-bypass=${ADMIN_TARGET.bypassSecret}&x-vercel-set-bypass-cookie=true`
    await adminPage.goto(url, { waitUntil: 'domcontentloaded' })
    await adminPage.goto('about:blank')
  }
  if (ADMIN_TARGET.base && ADMIN_TARGET.email && ADMIN_TARGET.password) {
    await loginWithRetry(
      adminPage,
      ADMIN_TARGET.base,
      ADMIN_TARGET.email,
      ADMIN_TARGET.password,
      ADMIN_TARGET.name,
    )
  } else {
    console.warn(
      'globalSetup: ADMIN 인증 시크릿(TEST_ADMIN_EMAIL/PASSWORD) 미설정 — ' +
        '세션 쿠키 생략 (어드민 인증 spec은 test.skip 처리됨)',
    )
  }
  await adminCtx.storageState({ path: ADMIN_STATE_PATH })
  await adminCtx.close()

  if (process.env['ROUND_DIRECT_E2E_ENABLED'] === 'true') {
    await createRoundDirectProjectState(browser, 'chromium')
    await createRoundDirectProjectState(browser, 'mobile')
  }

  await browser.close()
}
