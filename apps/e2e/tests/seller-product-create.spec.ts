import { test, expect } from '@playwright/test'
import { loginViaCredentials } from './_helpers/auth'

const BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr'

test.describe('????곹뭹 ?깅줉 ??怨듦컻', () => {
  test('誘몄씤利??묎렐 ??login 由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('誘몄씤利??곹뭹 紐⑸줉 ?묎렐 ??login 由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/products`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ?? ?몄쬆 ??湲곕뒫 寃利?????????????????????????????????????????????????

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('????곹뭹 ?깅줉 ???몄쬆 ?붾㈃', () => {
  test.skip(skipAuth, '?섍꼍蹂??TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD ?꾩슂')

  test.beforeEach(async ({ page }) => {
    await loginViaCredentials(page, BASE, sellerEmail!, sellerPassword!)
  })

  test('?곹뭹 ?깅줉 ?????ㅻ뜑 諛??ㅽ뀦 ?몃뵒耳?댄꽣 ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=?곹뭹 ?깅줉')).toBeVisible({ timeout: 10_000 })

    // 5?④퀎 ?ㅽ뀦 ?덉씠釉??뺤씤
    for (const label of ['?ъ쭊쨌?덉쥌', '?곗튂 ?좏깮', '?먮ℓ??硫붾え', 'AI 誘몃━蹂닿린', '媛寃㈑룸같??]) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible()
    }
  })

  test('Step 1 ???곹뭹紐??낅젰 ?꾨뱶 諛?移댄뀒怨좊━ 踰꾪듉 ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=?곹뭹 ?깅줉')).toBeVisible({ timeout: 10_000 })

    // ?곹뭹紐??낅젰 ?꾨뱶
    await expect(page.locator('input[placeholder="?곹뭹紐?]')).toBeVisible()

    // 移댄뀒怨좊━ 踰꾪듉 3媛?    await expect(page.locator('text=?덊솕')).toBeVisible()
    await expect(page.locator('text=??)).toBeVisible()
    await expect(page.locator('text=愿??)).toBeVisible()
  })

  test('Step 1 ???곹뭹紐?誘몄엯?????좏슚???ㅻ쪟 ?쒖떆', async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=?곹뭹 ?깅줉')).toBeVisible({ timeout: 10_000 })

    // ?곹뭹紐?鍮꾩썙?먭퀬 ?ㅼ쓬 ?대┃
    await page.locator('text=?ㅼ쓬').click()
    await expect(page.locator('text=?곹뭹紐낆쓣 ?낅젰?댁＜?몄슂')).toBeVisible({ timeout: 5_000 })
  })

  test('Step 1 ??Step 2 ???곹뭹紐??낅젰 ???ㅼ쓬 ?대┃ ???곗튂 ?좏깮 ?붾㈃ 吏꾩엯', async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=?곹뭹 ?깅줉')).toBeVisible({ timeout: 10_000 })

    await page.fill('input[placeholder="?곹뭹紐?]', '?뚯뒪???λ?')
    await page.locator('text=?ㅼ쓬').click()

    // Step 2: ?곗튂 ?좏깮 ?붾㈃ ???됱긽 ?듭뀡 ?몄텧
    await expect(page.locator('text=?덈뱶').first()).toBeVisible({ timeout: 5_000 })
  })

  test('Step 2 ???됱긽 誘몄꽑?????좏슚???ㅻ쪟 ?쒖떆', async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=?곹뭹 ?깅줉')).toBeVisible({ timeout: 10_000 })

    await page.fill('input[placeholder="?곹뭹紐?]', '?뚯뒪???λ?')
    await page.locator('text=?ㅼ쓬').click()
    await expect(page.locator('text=?덈뱶').first()).toBeVisible({ timeout: 5_000 })

    // ?됱긽 ?좏깮 ?놁씠 ?ㅼ쓬 ?대┃
    await page.locator('text=?ㅼ쓬').click()
    await expect(page.locator('text=?됱긽???섎굹 ?댁긽 ?좏깮?댁＜?몄슂')).toBeVisible({ timeout: 5_000 })
  })

  test('?꾩떆??????대┃ ??"??λ맖 ?? ?쇰뱶諛??쒖떆', async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=?곹뭹 ?깅줉')).toBeVisible({ timeout: 10_000 })

    await page.locator('text=?꾩떆???).click()
    await expect(page.locator('text=??λ맖 ??)).toBeVisible({ timeout: 3_000 })
  })

  test('珥덇린????踰꾪듉 ?대┃ ??Step 1?쇰줈 由ъ뀑', async ({ page }) => {
    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=?곹뭹 ?깅줉')).toBeVisible({ timeout: 10_000 })

    await page.fill('input[placeholder="?곹뭹紐?]', '?뚯뒪???곹뭹')
    await page.locator('text=珥덇린??).click()

    // ?곹뭹紐??꾨뱶媛 鍮꾩썙?몄빞 ??    await expect(page.locator('input[placeholder="?곹뭹紐?]')).toHaveValue('')
  })

  test('JS ?먮윭 ?놁쓬 ???섏씠吏 濡쒕뱶 ??500ms ?湲?, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/products/new`)
    await expect(page.locator('text=?곹뭹 ?깅줉')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(500)

    expect(errors.filter((e) => !e.includes('hydration'))).toHaveLength(0)
  })
})
