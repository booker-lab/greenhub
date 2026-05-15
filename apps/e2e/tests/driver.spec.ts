import { test, expect } from '@playwright/test'

const BASE = process.env['DRIVER_BASE'] ?? 'https://driver.greenlove.co.kr'

test.describe('드라이버 앱', () => {
  test('루트 접근 시 /board로 리디렉션', async ({ page }) => {
    await page.goto(BASE)
    await expect(page).toHaveURL(/board|login|signin/, { timeout: 10_000 })
  })

  test('미인증 상태에서 /board 접근 시 로그인으로 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/board`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('로그인 페이지 정상 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await expect(page.locator('body')).toBeVisible()
    // 드라이버 앱은 카카오 OAuth 전용
    await expect(page.locator('text=카카오로 시작하기')).toBeVisible()
    await expect(page.locator('text=Green Love 드라이버')).toBeVisible()
  })
})

// TEST_DRIVER_EMAIL / TEST_DRIVER_PASSWORD 환경변수 세팅 시 활성화
const driverEmail = process.env['TEST_DRIVER_EMAIL']
const driverPassword = process.env['TEST_DRIVER_PASSWORD']

test.describe('드라이버 배송 보드 (인증 필요)', () => {
  test.skip(!driverEmail || !driverPassword, '환경변수 TEST_DRIVER_EMAIL / TEST_DRIVER_PASSWORD 필요')

  test('로그인 후 배송 보드 진입', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await page.fill('input[type="email"]', driverEmail!)
    await page.fill('input[type="password"]', driverPassword!)
    await page.click('button[type="submit"]')
    await page.waitForURL(/board/, { timeout: 15_000 })
    await expect(page.locator('body')).toBeVisible()
  })
})
