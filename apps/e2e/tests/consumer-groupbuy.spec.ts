import { test, expect } from '@playwright/test'

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

test.describe('?뚮퉬??怨듬룞援щℓ ?섏씠吏', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/groupbuy`)
  })

  test('?섏씠吏 ?뺤긽 ?뚮뜑留?, async ({ page }) => {
    await expect(page.locator('text=怨듬룞援щℓ')).toBeVisible()
  })

  test('紐⑥쭛 以??뱀뀡 議댁옱', async ({ page }) => {
    // 濡쒕뵫 ?꾨즺 ?湲?    await page.waitForSelector('text=紐⑥쭛 以?, { timeout: 10_000 }).catch(() => {})
    const empty = page.locator('text=吏꾪뻾 以묒씤 怨듬룞援щℓ媛 ?놁뒿?덈떎')
    const list = page.locator('text=紐⑥쭛 以?)
    const isEmpty = await empty.isVisible()
    if (!isEmpty) {
      await expect(page.locator('text=紐⑥쭛 以?).first()).toBeVisible()
    }
  })

  test('怨듦뎄 移대뱶??吏꾪뻾瑜?諛??뚮뜑留?, async ({ page }) => {
    await page.waitForTimeout(2000) // ?곗씠??濡쒕뵫 ?湲?    const cards = page.locator('[class*="mantine-Progress"]')
    const count = await cards.count()
    if (count > 0) {
      await expect(cards.first()).toBeVisible()
    }
  })

  test('移대뱶 ?대┃ ???곹뭹 ?곸꽭濡??대룞', async ({ page }) => {
    await page.waitForTimeout(2000)
    const card = page.locator('a[href*="/products/"]').first()
    const exists = await card.count()
    if (exists > 0) {
      await card.click()
      await expect(page).toHaveURL(/\/products\//)
    }
  })
})
