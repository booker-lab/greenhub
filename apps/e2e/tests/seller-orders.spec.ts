import { test, expect } from '@playwright/test'

const BASE = 'https://seller.greenlove.co.kr'

test.describe('셀러 주문 관리 — 공개', () => {
  test('미인증 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ── 인증 후 기능 검증 ────────────────────────────────────────────────

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('셀러 주문 관리 — 인증 화면', () => {
  test.skip(skipAuth, '환경변수 TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 필요')

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await page.fill('input[type="email"]', sellerEmail!)
    await page.fill('input[type="password"]', sellerPassword!)
    await page.click('button[type="submit"]')
    await page.waitForURL(/orders|products|onboarding/, { timeout: 15_000 })
  })

  test('주문 관리 헤더 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })
  })

  test('5개 상태 탭 모두 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })
    for (const label of ['처리 필요', '준비 중', '배송 중', '완료', '취소']) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible()
    }
  })

  test('탭 클릭 — 각 탭 전환 시 JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })

    for (const label of ['준비 중', '배송 중', '완료', '취소', '처리 필요']) {
      await page.locator(`text=${label}`).first().click()
      await page.waitForTimeout(300)
    }

    expect(errors).toHaveLength(0)
  })

  test('실시간 연결 상태 텍스트 표시', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })
    // Firebase 연결 상태: 연결 중 → 실시간 연결 (또는 연결 오류)
    const statusLocator = page
      .locator('text=실시간 연결')
      .or(page.locator('text=연결 중'))
      .or(page.locator('text=연결 오류'))
    await expect(statusLocator.first()).toBeVisible({ timeout: 8_000 })
  })

  test('주문 없을 때 empty state 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })
    // 주문 카드 또는 빈 상태 메시지 중 하나가 존재해야 함
    await page.waitForTimeout(3_000)
    const hasOrders = await page.locator('[class*="Paper"]').count()
    const hasEmpty = await page.locator('text=현재 해당 주문이 없습니다').count()
    expect(hasOrders + hasEmpty).toBeGreaterThan(0)
  })
})
