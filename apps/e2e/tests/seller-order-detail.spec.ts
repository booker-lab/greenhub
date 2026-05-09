import { test, expect } from '@playwright/test'
import { loginViaCredentials } from './_helpers/auth'

const BASE = 'https://seller.greenlove.co.kr'

// ── 비인증 ────────────────────────────────────────────────────────────────────

test.describe('셀러 주문 상세 — 공개', () => {
  test('미인증 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/orders/fake-order-id`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ── 인증 후 ───────────────────────────────────────────────────────────────────

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('셀러 주문 상세 — 인증', () => {
  test.skip(skipAuth, '환경변수 TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 필요')

  test.beforeEach(async ({ page }) => {
    await loginViaCredentials(page, BASE, sellerEmail!, sellerPassword!)
  })

  // ── G2: 상품명 표시 ───────────────────────────────────────────────────────

  test('G2 — 주문 상세 상품정보 라벨이 "상품명"으로 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })

    // 주문 카드가 있으면 첫 번째 클릭, 없으면 skip
    const orderCard = page.locator('[data-testid="order-card"]').or(
      page.locator('text=주문 #').first()
    )
    const hasOrder = await orderCard.count() > 0
    if (!hasOrder) {
      test.info().annotations.push({ type: 'skip-reason', description: '테스트 계정에 주문 없음' })
      return
    }

    await orderCard.first().click()
    await expect(page.locator('text=주문 상세')).toBeVisible({ timeout: 10_000 })

    // "상품 ID" 라벨이 사라지고 "상품명"으로 교체되었는지 확인
    await expect(page.locator('text=상품명').first()).toBeVisible()
    await expect(page.locator('text=상품 ID')).not.toBeVisible()
  })

  // ── preparedAt: 빠른 선택지 UI ────────────────────────────────────────────

  test('preparedAt — 준비 시작 버튼 클릭 시 빠른 선택지 3개 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })

    const orderCard = page.locator('text=주문 #').first()
    const hasOrder = await orderCard.count() > 0
    if (!hasOrder) return

    await orderCard.click()
    await expect(page.locator('text=주문 상세')).toBeVisible({ timeout: 10_000 })

    // "준비 시작" 버튼이 있는 상태(ACCEPTED/CONFIRMED)에서만 검증
    const prepareBtn = page.locator('text=준비 시작')
    const canPrepare = await prepareBtn.count() > 0
    if (!canPrepare) return

    await prepareBtn.click()

    // 빠른 선택지 3개 버튼 모두 렌더링 확인
    await expect(page.locator('text=오늘 오후 2시')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('text=오늘 오후 4시')).toBeVisible()
    await expect(page.locator('text=내일 오전 9시')).toBeVisible()

    // datetime-local input이 없어야 함 (폐기 확인)
    await expect(page.locator('input[type="datetime-local"]')).not.toBeVisible()
  })

  test('preparedAt — 선택지 클릭 시 "선택됨:" 텍스트 표시', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })

    const orderCard = page.locator('text=주문 #').first()
    if (await orderCard.count() === 0) return

    await orderCard.click()
    await expect(page.locator('text=주문 상세')).toBeVisible({ timeout: 10_000 })

    const prepareBtn = page.locator('text=준비 시작')
    if (await prepareBtn.count() === 0) return

    await prepareBtn.click()
    await expect(page.locator('text=오늘 오후 2시')).toBeVisible({ timeout: 5_000 })

    await page.locator('text=오늘 오후 2시').click()
    await expect(page.locator('text=선택됨:')).toBeVisible()
  })

  test('preparedAt — 선택지 재클릭 시 deselect (안내문 복원)', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })

    const orderCard = page.locator('text=주문 #').first()
    if (await orderCard.count() === 0) return

    await orderCard.click()
    await expect(page.locator('text=주문 상세')).toBeVisible({ timeout: 10_000 })

    const prepareBtn = page.locator('text=준비 시작')
    if (await prepareBtn.count() === 0) return

    await prepareBtn.click()
    await expect(page.locator('text=오늘 오후 2시')).toBeVisible({ timeout: 5_000 })

    await page.locator('text=오늘 오후 2시').click()
    await expect(page.locator('text=선택됨:')).toBeVisible()

    // 재클릭 → deselect → 안내문 복원
    await page.locator('text=오늘 오후 2시').click()
    await expect(page.locator('text=선택하지 않아도')).toBeVisible()
  })

  test('주문 상세 진입 시 JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })

    const orderCard = page.locator('text=주문 #').first()
    if (await orderCard.count() === 0) {
      expect(errors).toHaveLength(0)
      return
    }

    await orderCard.click()
    await expect(page.locator('text=주문 상세')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(500)

    expect(errors).toHaveLength(0)
  })
})
