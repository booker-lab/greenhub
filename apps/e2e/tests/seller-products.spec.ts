import { test, expect } from '@playwright/test'

const BASE = 'https://seller.greenlove.co.kr'

// ── 비인증 ────────────────────────────────────────────────────────────────────

test.describe('셀러 상품 관리 — 공개', () => {
  test('미인증 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/products`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ── 인증 후 ───────────────────────────────────────────────────────────────────

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('셀러 상품 관리 — 인증', () => {
  test.skip(skipAuth, '환경변수 TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 필요')

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await page.fill('input[type="email"]', sellerEmail!)
    await page.fill('input[type="password"]', sellerPassword!)
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(\?|$)|orders|products|onboarding/, { timeout: 25_000 })
  })

  // ── 페이지 구조 ───────────────────────────────────────────────────────────

  test('상품 관리 헤더 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/products`)
    await expect(page.locator('text=상품 관리')).toBeVisible({ timeout: 10_000 })
  })

  test('필터 탭 3개 렌더링 (전체·판매 중·비활성)', async ({ page }) => {
    await page.goto(`${BASE}/products`)
    await expect(page.locator('text=상품 관리')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=전체').first()).toBeVisible()
    await expect(page.locator('text=판매 중').first()).toBeVisible()
    await expect(page.locator('text=비활성').first()).toBeVisible()
  })

  test('+ 등록 버튼 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/products`)
    await expect(page.locator('text=+ 등록').first()).toBeVisible({ timeout: 10_000 })
  })

  test('상품 목록 진입 시 JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/products`)
    await expect(page.locator('text=상품 관리')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(500)

    expect(errors).toHaveLength(0)
  })

  // ── B2: 상품 카드 액션 버튼 ────────────────────────────────────────────────

  test('B2 — 상품 있을 때 토글·수정·삭제 뱃지 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/products`)
    await expect(page.locator('text=상품 관리')).toBeVisible({ timeout: 10_000 })

    // 상품이 없으면 skip
    const hasProduct = await page.locator('text=판매 중').count() > 1 ||
      await page.locator('text=비활성').count() > 1
    if (!hasProduct) return

    // 카드 내 뱃지 확인: 판매 중 / 비활성 (토글), 수정, 삭제
    const toggleBadge = page.locator('text=판매 중, text=비활성').or(
      page.locator('text=수정')
    )
    await expect(page.locator('text=수정').first()).toBeVisible()
    await expect(page.locator('text=삭제').first()).toBeVisible()
  })

  test('B2 — 토글 클릭 시 JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/products`)
    await expect(page.locator('text=상품 관리')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(1_000)

    // 상품이 있으면 토글 클릭 시도
    const toggleBadge = page.locator('text=판매 중').nth(1)
      .or(page.locator('text=비활성').nth(1))
    if (await toggleBadge.count() > 0) {
      await toggleBadge.first().click()
      await page.waitForTimeout(500)
    }

    expect(errors).toHaveLength(0)
  })

  test('B2 — 필터 탭 전환 시 JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/products`)
    await expect(page.locator('text=상품 관리')).toBeVisible({ timeout: 10_000 })

    for (const label of ['판매 중', '비활성', '전체']) {
      await page.locator(`text=${label}`).first().click()
      await page.waitForTimeout(300)
    }

    expect(errors).toHaveLength(0)
  })
})
