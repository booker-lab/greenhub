import { defineConfig, devices } from '@playwright/test'
import { config } from 'dotenv'
import { resolve } from 'path'
import { BYPASS_STATE_PATH } from './tests/_helpers/auth'

config({ path: resolve(__dirname, '.env') })

// 로컬 대상 모드(scripts/round-direct-e2e-local.mjs)는 한국의 로컬 앱이 해외 스테이징 API를 부르므로
// 원격 Preview보다 첫 화면 데이터가 늦다. 화면 확인 대기만 로컬 모드에서 늘리고 원격 기준은 그대로 둔다.
const isLocalTargetMode = process.env.ROUND_DIRECT_E2E_TARGET_MODE === 'local'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  ...(isLocalTargetMode ? { expect: { timeout: 15_000 } } : {}),
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  // globalSetup이 Preview 배포의 Vercel SSO 우회 쿠키(_vercel_jwt)를 발급해
  // .bypass-state.json에 저장하고, 모든 컨텍스트가 storageState로 재사용한다.
  // 인증이 필요한 spec은 describe 상단에서 test.use({ storageState:
  // AUTH_STATE_PATH })로 .auth-state.json(세션 쿠키 포함)을 덮어쓴다 (#CL-23).
  globalSetup: resolve(__dirname, 'global-setup.ts'),
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    storageState: BYPASS_STATE_PATH,
    // 옵션 B 헤더(x-e2e-test-token)·Vercel bypass 헤더 모두 extraHTTPHeaders로
    // 전역 주입하지 않는다. Firebase Identity Toolkit 등 third-party API 호출에도
    // 헤더가 따라가 CORS preflight를 트리거하고 차단되는 부수효과가 발생한다.
    // SSO 우회는 도메인 바인딩 쿠키(storageState)로, 옵션 B 토큰은
    // _helpers/auth.ts에서 NextAuth POST 1회에만 명시적으로 주입한다.
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],
})
