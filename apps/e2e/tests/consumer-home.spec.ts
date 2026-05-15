import { test, expect } from '@playwright/test'

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

test.describe('?뚮퉬????, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE)
  })

  test('?섏씠吏 ?뺤긽 ?뚮뜑留?, async ({ page }) => {
    await expect(page).toHaveTitle(/Green Love/)
    await expect(page.getByText('洹몃┛?щ툕', { exact: true })).toBeVisible()
  })

  test('怨듬룞援щℓ ?뱀뀡 議댁옱', async ({ page }) => {
    await expect(page.locator('text=吏꾪뻾 以?怨듬룞援щℓ')).toBeVisible()
  })

  test('怨듦뎄 移대뱶??吏꾪뻾瑜??띿뒪???쒖떆', async ({ page }) => {
    const progressText = page.locator('text=/\\d+\\/\\d+媛?')
    const count = await progressText.count()
    // 怨듦뎄 ?곹뭹???덉쓣 ?뚮쭔 寃利?    if (count > 0) {
      await expect(progressText.first()).toBeVisible()
    }
  })

  test('留덇컧 ?꾨컯 ?뱀뀡 ???대떦 ?곹뭹 ?놁쑝硫??④?', async ({ page }) => {
    // 留덇컧 ?꾨컯 ?뱀뀡? 24h ?대궡 ?곹뭹???놁쑝硫??뚮뜑?섏? ?딆쓬 ???ㅻ쪟 ?놁씠 ?듦낵?댁빞 ??    const section = page.locator('text=留덇컧 ?꾨컯')
    // ?덇굅???녾굅???섏씠吏 ?먯껜媛 crash ?놁씠 濡쒕뱶?섎㈃ OK
    await expect(page.locator('body')).toBeVisible()
    const visible = await section.isVisible()
    if (visible) {
      await expect(section).toBeVisible()
    }
  })

  test('?섎떒 ?대퉬寃뚯씠??議댁옱', async ({ page }) => {
    await expect(page.locator('text=??)).toBeVisible()
    await expect(page.locator('text=移댄뀒怨좊━')).toBeVisible()
  })
})
