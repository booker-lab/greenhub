import { test, expect } from '@playwright/test'
import { AUTH_STATE_PATH } from './_helpers/auth'

const BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr'

// 세션39(#CL-33): 준비 물량 탭(/prep) 신설 — 미발송·일반 주문을 productId별 집계.

// ── 비인증 ────────────────────────────────────────────────────────────────────

test.describe('셀러 준비 물량 — 공개', () => {
  test('미인증 /prep 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/prep`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ── 인증 후 ───────────────────────────────────────────────────────────────────

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('셀러 준비 물량 — 인증', () => {
  test.use({ storageState: AUTH_STATE_PATH })

  test.skip(skipAuth, '환경변수 TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 필요')

  test('준비 물량 헤더 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/prep`)
    await expect(page.locator('text=준비 물량').first()).toBeVisible({ timeout: 10_000 })
  })

  test('준비 물량 진입 시 JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/prep`)
    await expect(page.locator('text=준비 물량').first()).toBeVisible({ timeout: 10_000 })
    // 집계표 또는 빈 상태("오늘 준비할 물량이 없습니다") 중 하나가 렌더링
    await expect(
      page.locator('text=오늘 준비 물량').or(page.locator('text=오늘 준비할 물량이 없습니다')),
    ).toBeVisible({ timeout: 12_000 })
    await page.waitForTimeout(500)

    expect(errors).toHaveLength(0)
  })
})
