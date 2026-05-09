import { defineConfig, devices } from '@playwright/test'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(__dirname, '.env') })

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // 옵션 B 헤더(x-e2e-test-token)는 NextAuth credentials POST 1회에만 필요하므로
    // _helpers/auth.ts에서 명시적으로 주입한다. extraHTTPHeaders로 전역 주입하면
    // Firebase Identity Toolkit 등 third-party API 호출에도 헤더가 따라가
    // CORS preflight를 트리거하고 차단되는 부수효과가 발생한다.
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
