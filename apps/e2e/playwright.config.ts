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
    // 옵션 B: 모든 요청에 e2e 게이팅 토큰 주입 (헤더 없으면 authorize null 반환)
    extraHTTPHeaders: process.env['E2E_TEST_SECRET']
      ? { 'x-e2e-test-token': process.env['E2E_TEST_SECRET'] }
      : {},
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
