import { test, expect } from '@playwright/test'
import { AUTH_STATE_PATH } from './_helpers/auth'
import { genericPreviewFixture } from './_helpers/generic-preview'

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

const consumerEmail = process.env['TEST_CONSUMER_EMAIL']
const consumerPassword = process.env['TEST_CONSUMER_PASSWORD']
const skipAuth = !consumerEmail || !consumerPassword
const fixture = genericPreviewFixture()

/**
 * 세션51 T6-A — 소비자 일반 주문 배송일 선택 회귀 가드.
 * 선행: canonical Preview fixture manifest가 run-owned store의 dailyCaps를 시드.
 *
 * DeliveryDatePicker는 일반 상품 + (direct|hub) 배송일 때만 노출, 공동구매·택배는 미노출.
 * 시드된 활성 슬롯이 1개 이상 활성 일자로 클릭 가능해야 한다.
 */
test.describe('Consumer — 배송일 선택 (인증)', () => {
  test.use({ storageState: AUTH_STATE_PATH })
  test.skip(skipAuth, '환경변수 TEST_CONSUMER_EMAIL / TEST_CONSUMER_PASSWORD 필요')

  test('일반 상품 상세 — 배송일 선택 캘린더 노출 + 활성 일자 1개 이상', async ({ page }) => {
    await page.goto(`${BASE}/products/${fixture.normalProductId}`)
    await page.waitForLoadState('load')

    const calendarLabel = page.getByText('배송 희망일')
    // run-owned normal/direct 상품이므로 배송일 선택 surface가 반드시 나타나야 한다.
    await expect(calendarLabel.first()).toBeVisible({ timeout: 10_000 })

    // 활성 가능한(disabled=false) 일자 버튼이 1개 이상 — 시드된 dailyCaps 표면화
    const activeDateBtns = page.locator(
      'button:not([disabled])[type="button"]:has-text("석")',
    )
    await expect.poll(async () => await activeDateBtns.count(), { timeout: 10_000 }).toBeGreaterThan(0)
  })

  test('택배 선택 시 배송일 캘린더 미노출 — 슬롯 미검증 분기', async ({ page }) => {
    await page.goto(`${BASE}/products/${fixture.normalProductId}`)
    await page.waitForLoadState('load')

    const calendarLabel = page.getByText('배송 희망일')
    await expect(calendarLabel.first()).toBeVisible({ timeout: 10_000 })

    // 택배 버튼 클릭 → 캘린더 숨김
    await page.getByRole('button', { name: '택배' }).click()
    await expect(calendarLabel).toBeHidden({ timeout: 3_000 })
  })
})
