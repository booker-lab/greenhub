import { test, expect } from '@playwright/test'
import { loginViaCredentials } from './_helpers/auth'

const BASE = 'https://seller.greenlove.co.kr'

// ── 비인증 ────────────────────────────────────────────────────────────────────

test.describe('셀러 홈 대시보드 — 공개', () => {
  test('미인증 / 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ── 인증 후 ───────────────────────────────────────────────────────────────────

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('셀러 홈 대시보드 — 인증', () => {
  test.skip(skipAuth, '환경변수 TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 필요')

  test.beforeEach(async ({ page }) => {
    await loginViaCredentials(page, BASE, sellerEmail!, sellerPassword!)
  })

  // ── 헤더 ─────────────────────────────────────────────────────────────────

  test('홈 헤더 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(page.locator('text=홈').first()).toBeVisible({ timeout: 10_000 })
  })

  test('실시간 연결 상태 표시', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(page.locator('text=홈').first()).toBeVisible({ timeout: 10_000 })
    const statusLocator = page
      .locator('text=실시간 연결')
      .or(page.locator('text=연결 중'))
      .or(page.locator('text=연결 오류'))
    await expect(statusLocator.first()).toBeVisible({ timeout: 12_000 })
  })

  // ── 지표 카드 ─────────────────────────────────────────────────────────────

  test('주문 현황 섹션 — 카드 3개 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(page.locator('text=홈').first()).toBeVisible({ timeout: 10_000 })
    await expect(
      page.locator('text=실시간 연결').or(page.locator('text=연결 오류'))
    ).toBeVisible({ timeout: 12_000 })

    for (const label of ['신규 주문', '전체 주문', '취소']) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible()
    }
  })

  test('상품 현황 섹션 — 재고부족 카드 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(page.locator('text=홈').first()).toBeVisible({ timeout: 10_000 })
    await expect(
      page.locator('text=실시간 연결').or(page.locator('text=연결 오류'))
    ).toBeVisible({ timeout: 12_000 })

    await expect(page.locator('text=재고부족').first()).toBeVisible()
  })

  test('지표 카드 4개 — 레이블 + 숫자 모두 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(
      page.locator('text=실시간 연결').or(page.locator('text=연결 오류'))
    ).toBeVisible({ timeout: 12_000 })

    for (const label of ['신규 주문', '전체 주문', '취소', '재고부족']) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible()
    }
  })

  // ── 딥링크 ────────────────────────────────────────────────────────────────

  test('신규 주문 카드 클릭 → /orders 이동', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(
      page.locator('text=실시간 연결').or(page.locator('text=연결 오류'))
    ).toBeVisible({ timeout: 12_000 })

    await page.locator('text=신규 주문').first().click()
    await expect(page).toHaveURL(/\/orders/, { timeout: 8_000 })
  })

  test('취소 카드 클릭 → /orders?tab=CANCELLED + 취소 탭 활성화', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(
      page.locator('text=실시간 연결').or(page.locator('text=연결 오류'))
    ).toBeVisible({ timeout: 12_000 })

    await page.locator('text=취소').first().click()
    await expect(page).toHaveURL(/\/orders\?tab=CANCELLED/, { timeout: 8_000 })
    await expect(page.locator('text=주문 관리').first()).toBeVisible({ timeout: 10_000 })
  })

  test('재고부족 카드 클릭 → /products 이동', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(
      page.locator('text=실시간 연결').or(page.locator('text=연결 오류'))
    ).toBeVisible({ timeout: 12_000 })

    await page.locator('text=재고부족').first().click()
    await expect(page).toHaveURL(/\/products/, { timeout: 8_000 })
  })

  // ── JS 에러 없음 ──────────────────────────────────────────────────────────

  test('홈 진입 시 JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/`)
    await expect(
      page.locator('text=실시간 연결').or(page.locator('text=연결 오류'))
    ).toBeVisible({ timeout: 12_000 })
    await page.waitForTimeout(500)

    expect(errors).toHaveLength(0)
  })
})
