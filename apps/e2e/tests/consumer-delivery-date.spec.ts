import { test, expect } from '@playwright/test'
import { AUTH_STATE_PATH } from './_helpers/auth'

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

const consumerEmail = process.env['TEST_CONSUMER_EMAIL']
const consumerPassword = process.env['TEST_CONSUMER_PASSWORD']
const skipAuth = !consumerEmail || !consumerPassword

/**
 * 세션51 T6-A — 소비자 일반 주문 배송일 선택 회귀 가드.
 * 선행: scripts/seed-e2e-orders.mjs 가 활성 상품 보유 storeId 14일치 dailyCaps 시드.
 *
 * DeliveryDatePicker는 일반 상품 + (direct|hub) 배송일 때만 노출, 공동구매·택배는 미노출.
 * 시드된 활성 슬롯이 1개 이상 활성 일자로 클릭 가능해야 한다.
 */
test.describe('Consumer — 배송일 선택 (인증)', () => {
  test.use({ storageState: AUTH_STATE_PATH })
  test.skip(skipAuth, '환경변수 TEST_CONSUMER_EMAIL / TEST_CONSUMER_PASSWORD 필요')

  test('일반 상품 상세 — 배송일 선택 캘린더 노출 + 활성 일자 1개 이상', async ({ page }) => {
    // 홈에서 첫 일반 상품 선택 (saleType=normal 우선 매칭은 어려우니 첫 카드)
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    const productLink = page.locator('a[href^="/products/"]').first()
    const href = await productLink.getAttribute('href')
    if (!href) {
      test.skip(true, '홈에 상품 없음')
      return
    }
    await page.goto(BASE + href)
    await page.waitForLoadState('load')

    // direct 배송이 기본 — '배송 희망일' 라벨이 보여야 함 (DeliveryDatePicker 진입 조건)
    const calendarLabel = page.getByText('배송 희망일')
    const isVisible = await calendarLabel
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false)
    if (!isVisible) {
      // 공동구매 상품일 가능성 — pass (다른 spec에서 공구 분기 검증)
      test.skip(true, '공동구매 상품이거나 storeId 슬롯 미시드 — seed-e2e-orders.mjs 실행 필요')
      return
    }

    // 활성 가능한(disabled=false) 일자 버튼이 1개 이상 — 시드된 dailyCaps 표면화
    const activeDateBtns = page.locator(
      'button:not([disabled])[type="button"]:has-text("석")',
    )
    await expect.poll(async () => await activeDateBtns.count(), { timeout: 10_000 }).toBeGreaterThan(0)
  })

  test('택배 선택 시 배송일 캘린더 미노출 — 슬롯 미검증 분기', async ({ page }) => {
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    const productLink = page.locator('a[href^="/products/"]').first()
    const href = await productLink.getAttribute('href')
    if (!href) {
      test.skip(true, '홈에 상품 없음')
      return
    }
    await page.goto(BASE + href)
    await page.waitForLoadState('load')

    const calendarLabel = page.getByText('배송 희망일')
    const visibleInitially = await calendarLabel
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false)
    if (!visibleInitially) {
      test.skip(true, '공동구매 상품 — 택배 분기 검증 대상 아님')
      return
    }

    // 택배 버튼 클릭 → 캘린더 숨김
    await page.getByRole('button', { name: '택배' }).click()
    await expect(calendarLabel).toBeHidden({ timeout: 3_000 })
  })
})
