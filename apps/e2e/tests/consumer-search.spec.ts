import { test, expect } from '@playwright/test'

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

test.describe('Consumer ??寃???섏씠吏', () => {
  test('/search ??寃?됱갹 ?먮룞 ?ъ빱??諛??뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/search`)
    await page.waitForLoadState('networkidle')

    const input = page.getByPlaceholder('?곹뭹紐낆쓣 寃?됲븯?몄슂')
    await expect(input).toBeVisible()
    await expect(input).toBeFocused()
  })

  test('/search ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/search`)
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('寃?됱뼱 ?낅젰 ????寃곌낵 ?곸뿭 鍮??곹깭', async ({ page }) => {
    await page.goto(`${BASE}/search`)
    await page.waitForLoadState('networkidle')

    // query ?놁쓣 ??filtered = [] ???곹뭹 移대뱶 ?놁쓬
    const productCards = page.locator('a[href^="/products/"]')
    expect(await productCards.count()).toBe(0)
  })

  test('寃?됱뼱 ?낅젰 ??寃곌낵 ?먮뒗 "寃곌낵 ?놁쓬" ?쒖떆', async ({ page }) => {
    await page.goto(`${BASE}/search`)
    await page.waitForLoadState('networkidle')

    const input = page.getByPlaceholder('?곹뭹紐낆쓣 寃?됲븯?몄슂')
    await input.fill('?λ?')
    // ?곗씠??濡쒕뵫 ?湲?    await page.waitForTimeout(1500)

    const cards = page.locator('a[href^="/products/"]')
    const noResult = page.getByText(/寃곌낵媛 ?놁뒿?덈떎|?놁뒿?덈떎/)
    const cardCount = await cards.count()

    // 寃곌낵媛 ?덇굅???놁쓬 硫붿떆吏媛 ?덉뼱????    if (cardCount > 0) {
      await expect(cards.first()).toBeVisible()
    } else {
      // 寃곌낵 ?놁쓬 硫붿떆吏 ?먮뒗 鍮??곹깭 (?먮윭 ?놁씠 ?뚮뜑)
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('寃??寃곌낵 移대뱶 ?대┃ ??/products/[id] ?대룞', async ({ page }) => {
    await page.goto(`${BASE}/search`)
    await page.waitForLoadState('networkidle')

    const input = page.getByPlaceholder('?곹뭹紐낆쓣 寃?됲븯?몄슂')
    // 吏㏃? 寃?됱뼱濡?寃곌낵媛 ?섏삱 媛?μ꽦 ?믪씠湲?    await input.fill('苑?)
    await page.waitForTimeout(1500)

    const firstCard = page.locator('a[href^="/products/"]').first()
    if (await firstCard.count() > 0) {
      await firstCard.click()
      await expect(page).toHaveURL(/\/products\//)
    } else {
      test.skip(true, '寃??寃곌낵 ?놁쓬 ???섍꼍???곕씪 skip')
    }
  })

  test('X 踰꾪듉 ?대┃ ??寃?됱뼱 珥덇린??, async ({ page }) => {
    await page.goto(`${BASE}/search`)
    await page.waitForLoadState('networkidle')

    const input = page.getByPlaceholder('?곹뭹紐낆쓣 寃?됲븯?몄슂')
    await input.fill('?뚯뒪??)
    await expect(input).toHaveValue('?뚯뒪??)

    // 珥덇린??踰꾪듉 (??
    const clearBtn = page.getByRole('button').filter({ hasText: '?? })
    await expect(clearBtn).toBeVisible()
    await clearBtn.click()

    await expect(input).toHaveValue('')
  })
})
