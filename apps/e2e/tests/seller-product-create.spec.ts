import { test, expect } from '@playwright/test'

const BASE = 'https://seller.greenlove.co.kr'

test.describe('셀러 상품 등록 — 공개', () => {
  test('미인증 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('미인증 상품 목록 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/products`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ── 인증 후 기능 검증 ────────────────────────────────────────────────

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('셀러 상품 등록 — 인증 화면', () => {
  test.skip(skipAuth, '환경변수 TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 필요')

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await page.fill('input[type="email"]', sellerEmail!)
    await page.fill('input[type="password"]', sellerPassword!)
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(\?|$)|orders|products|onboarding/, { timeout: 25_000 })
  })

  test('상품 등록 폼 — 헤더 및 스텝 인디케이터 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=상품 등록')).toBeVisible({ timeout: 10_000 })

    // 5단계 스텝 레이블 확인
    for (const label of ['사진·품종', '터치 선택', '판매자 메모', 'AI 미리보기', '가격·배송']) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible()
    }
  })

  test('Step 1 — 상품명 입력 필드 및 카테고리 버튼 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=상품 등록')).toBeVisible({ timeout: 10_000 })

    // 상품명 입력 필드
    await expect(page.locator('input[placeholder="상품명"]')).toBeVisible()

    // 카테고리 버튼 3개
    await expect(page.locator('text=절화')).toBeVisible()
    await expect(page.locator('text=난')).toBeVisible()
    await expect(page.locator('text=관엽')).toBeVisible()
  })

  test('Step 1 — 상품명 미입력 시 유효성 오류 표시', async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=상품 등록')).toBeVisible({ timeout: 10_000 })

    // 상품명 비워두고 다음 클릭
    await page.locator('text=다음').click()
    await expect(page.locator('text=상품명을 입력해주세요')).toBeVisible({ timeout: 5_000 })
  })

  test('Step 1 → Step 2 — 상품명 입력 후 다음 클릭 시 터치 선택 화면 진입', async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=상품 등록')).toBeVisible({ timeout: 10_000 })

    await page.fill('input[placeholder="상품명"]', '테스트 장미')
    await page.locator('text=다음').click()

    // Step 2: 터치 선택 화면 — 색상 옵션 노출
    await expect(page.locator('text=레드').first()).toBeVisible({ timeout: 5_000 })
  })

  test('Step 2 — 색상 미선택 시 유효성 오류 표시', async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=상품 등록')).toBeVisible({ timeout: 10_000 })

    await page.fill('input[placeholder="상품명"]', '테스트 장미')
    await page.locator('text=다음').click()
    await expect(page.locator('text=레드').first()).toBeVisible({ timeout: 5_000 })

    // 색상 선택 없이 다음 클릭
    await page.locator('text=다음').click()
    await expect(page.locator('text=색상을 하나 이상 선택해주세요')).toBeVisible({ timeout: 5_000 })
  })

  test('임시저장 — 클릭 후 "저장됨 ✓" 피드백 표시', async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=상품 등록')).toBeVisible({ timeout: 10_000 })

    await page.locator('text=임시저장').click()
    await expect(page.locator('text=저장됨 ✓')).toBeVisible({ timeout: 3_000 })
  })

  test('초기화 — 버튼 클릭 시 Step 1으로 리셋', async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=상품 등록')).toBeVisible({ timeout: 10_000 })

    await page.fill('input[placeholder="상품명"]', '테스트 상품')
    await page.locator('text=초기화').click()

    // 상품명 필드가 비워져야 함
    await expect(page.locator('input[placeholder="상품명"]')).toHaveValue('')
  })

  test('JS 에러 없음 — 페이지 로드 후 500ms 대기', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=상품 등록')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(500)

    expect(errors.filter((e) => !e.includes('hydration'))).toHaveLength(0)
  })
})
