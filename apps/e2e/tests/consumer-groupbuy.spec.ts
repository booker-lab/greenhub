import { test, expect } from '@playwright/test'

const BASE = 'https://greenlove.co.kr'

test.describe('소비자 공동구매 페이지', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/groupbuy`)
  })

  test('페이지 정상 렌더링', async ({ page }) => {
    await expect(page.locator('text=공동구매')).toBeVisible()
  })

  test('모집 중 섹션 존재', async ({ page }) => {
    // 로딩 완료 대기
    await page.waitForSelector('text=모집 중', { timeout: 10_000 }).catch(() => {})
    const empty = page.locator('text=진행 중인 공동구매가 없습니다')
    const list = page.locator('text=모집 중')
    const isEmpty = await empty.isVisible()
    if (!isEmpty) {
      await expect(page.locator('h5:has-text("모집 중"), [data-order="5"]:has-text("모집 중")').first()).toBeVisible()
    }
  })

  test('공구 카드에 진행률 바 렌더링', async ({ page }) => {
    await page.waitForTimeout(2000) // 데이터 로딩 대기
    const cards = page.locator('[class*="mantine-Progress"]')
    const count = await cards.count()
    if (count > 0) {
      await expect(cards.first()).toBeVisible()
    }
  })

  test('카드 클릭 시 상품 상세로 이동', async ({ page }) => {
    await page.waitForTimeout(2000)
    const card = page.locator('a[href*="/products/"]').first()
    const exists = await card.count()
    if (exists > 0) {
      await card.click()
      await expect(page).toHaveURL(/\/products\//)
    }
  })
})
