import { test, expect } from '@playwright/test'

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

test.describe('Consumer ???곹뭹 ?곸꽭 ?섏씠吏', () => {
  let productHref: string | null = null

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    const link = page.locator('a[href^="/products/"]').first()
    if (await link.count() > 0) {
      productHref = await link.getAttribute('href')
    }
  })

  test('?????곹뭹 ?대┃ ??/products/[id] ?대룞', async ({ page }) => {
    if (!productHref) {
      test.skip(true, '?덉뿉 ?곹뭹 ?놁쓬')
      return
    }
    await page.goto(BASE + productHref)
    await page.waitForLoadState('load')
    await expect(page).toHaveURL(/\/products\//)
  })

  test('?곹뭹 ?곸꽭 ???ㅻ줈媛湲?踰꾪듉 ?몄텧', async ({ page }) => {
    if (!productHref) {
      test.skip(true, '?덉뿉 ?곹뭹 ?놁쓬')
      return
    }
    await page.goto(BASE + productHref)
    await page.waitForLoadState('load')
    // ProductTopBar ??<button type="button"> ??span ?띿뒪??"?ㅻ줈"
    const backBtn = page.getByRole('button', { name: '?ㅻ줈' })
    await expect(backBtn).toBeVisible()
  })

  test('?곹뭹 ?곸꽭 ???대?吏 ?곸뿭 ?뚮뜑留?, async ({ page }) => {
    if (!productHref) {
      test.skip(true, '?덉뿉 ?곹뭹 ?놁쓬')
      return
    }
    await page.goto(BASE + productHref)
    await page.waitForLoadState('load')
    const img = page.locator('img').first()
    await expect(img).toBeVisible()
  })

  test('?곹뭹 ?곸꽭 ??媛寃??뺣낫 ?쒖떆 (?レ옄+??', async ({ page }) => {
    if (!productHref) {
      test.skip(true, '?덉뿉 ?곹뭹 ?놁쓬')
      return
    }
    await page.goto(BASE + productHref)
    await page.waitForLoadState('load')
    // "?? ?띿뒪?멸? ?ы븿???붿냼 議댁옱
    const priceEl = page.getByText(/\d{1,3}(,\d{3})*??)
    await expect(priceEl.first()).toBeVisible()
  })

  test('?곹뭹 ?곸꽭 ???닿린 ?먮뒗 李몄뿬 踰꾪듉 ?몄텧', async ({ page }) => {
    if (!productHref) {
      test.skip(true, '?덉뿉 ?곹뭹 ?놁쓬')
      return
    }
    await page.goto(BASE + productHref)
    await page.waitForLoadState('load')
    // "?λ컮援щ땲 ?닿린" or "怨듬룞援щℓ 李몄뿬" or "諛붾줈 援щℓ"
    const actionBtn = page.getByRole('button', {
      name: /?λ컮援щ땲|李몄뿬|援щℓ|?닿린/,
    }).first()
    await expect(actionBtn).toBeVisible({ timeout: 10_000 })
  })

  test('?곹뭹 ?곸꽭 ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    if (!productHref) {
      test.skip(true, '?덉뿉 ?곹뭹 ?놁쓬')
      return
    }
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(BASE + productHref)
    await page.waitForLoadState('load')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad') && !e.includes('404')
    )
    expect(critical).toHaveLength(0)
  })

  test('議댁옱?섏? ?딅뒗 ?곹뭹 ID ???щ옒???놁쓬 (404 UI)', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/products/nonexistent-product-id-00000`)
    await page.waitForLoadState('load')
    // ?섏씠吏 ?먯껜媛 ?щ옒???놁씠 ?뚮뜑?섏뼱????    await expect(page.locator('body')).toBeVisible()
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad') && !e.includes('404')
    )
    expect(critical).toHaveLength(0)
  })
})
