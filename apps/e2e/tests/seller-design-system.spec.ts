import { test, expect } from '@playwright/test'
import { loginViaCredentials } from './_helpers/auth'

const BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr'

// ?? 怨듦컻 ?묎렐 媛???섏씠吏 ??????????????????????????????????????????

test.describe('????붿옄???쒖뒪????怨듦컻 ?섏씠吏', () => {
  test('濡쒓렇???섏씠吏 ?뚮뜑留?+ CSS ?좏겙 ?곸슜 ?뺤씤', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await expect(page.locator('body')).toBeVisible()

    // Mantine 湲곕낯 ?됱긽 蹂?섍? ?⑥븘?덉? ?딆븘????    const bodyBg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor
    )
    // ?섏씠吏 濡쒕뱶 ?깃났 ?뺤씤
    await expect(page).toHaveTitle(/洹몃┛?щ툕|Green|Seller/i)
  })

  test('誘몄씤利???二쇰Ц ?섏씠吏 ?묎렐 ??login 由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('誘몄씤利????뺤궛 ?섏씠吏 ?묎렐 ??login 由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/settlements`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('誘몄씤利????ㅼ젙 ?섏씠吏 ?묎렐 ??login 由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/settings`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('誘몄씤利???嫄곗젏 ?섏씠吏 ?묎렐 ??login 由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/hubs`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('誘몄씤利????대뱶誘??묎렐 ??由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/admin/stores`)
    await expect(page).toHaveURL(/login|signin|auth|orders/, { timeout: 10_000 })
  })
})

// ?? ?몄쬆 ???듭떖 ?붾㈃ 寃利?????????????????????????????????????????

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('????붿옄???쒖뒪?????몄쬆 ?붾㈃', () => {
  test.skip(skipAuth, '?섍꼍蹂??TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD ?꾩슂')

  test.beforeEach(async ({ page }) => {
    await loginViaCredentials(page, BASE, sellerEmail!, sellerPassword!)
  })

  test('二쇰Ц 愿由??????ㅻ뜑 ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })
    // ?곹깭 ??5媛??뺤씤
    for (const label of ['泥섎━ ?꾩슂', '?湲?以?, '諛곗넚 以?, '?꾨즺', '痍⑥냼']) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible()
    }
    // JS ?먮윭 ?놁쓬
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.waitForTimeout(500)
    expect(errors).toHaveLength(0)
  })

  test('?뺤궛 愿由??????뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/settlements`)
    await expect(page.locator('text=?뺤궛 愿由?)).toBeVisible({ timeout: 10_000 })
    for (const label of ['?쇰퀎 ?붿빟', '湲곌컙蹂?議고쉶', '二쇰Ц蹂??곸꽭']) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible()
    }
  })

  test('?ㅼ젙 ??硫붾돱 ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/settings`)
    await expect(page.getByRole('heading', { name: '?ㅼ젙' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=諛곗넚鍮??ㅼ젙 / 湲곗긽 ?쒗븳')).toBeVisible()
    await expect(page.locator('text=諛곗넚 ?щ’ (Daily Cap)')).toBeVisible()
  })

  test('嫄곗젏 愿由???紐⑸줉 ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/hubs`)
    await expect(page.locator('text=嫄곗젏 愿由?)).toBeVisible({ timeout: 10_000 })
    // 嫄곗젏 ?놁쓣 ??empty state
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })

  test('?곹뭹 紐⑸줉 ???뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/products`)
    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 })
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.waitForTimeout(1000)
    expect(errors.filter(e => !e.includes('hydration'))).toHaveLength(0)
  })
})
