import { test, expect } from '@playwright/test'
import { loginViaCredentials } from './_helpers/auth'

const BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr'

// ?? 鍮꾩씤利?????????????????????????????????????????????????????????????????????

test.describe('????곹뭹 愿由???怨듦컻', () => {
  test('誘몄씤利??묎렐 ??login 由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/products`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ?? ?몄쬆 ?????????????????????????????????????????????????????????????????????

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('????곹뭹 愿由????몄쬆', () => {
  test.skip(skipAuth, '?섍꼍蹂??TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD ?꾩슂')

  test.beforeEach(async ({ page }) => {
    await loginViaCredentials(page, BASE, sellerEmail!, sellerPassword!)
  })

  // ?? ?섏씠吏 援ъ“ ???????????????????????????????????????????????????????????

  test('?곹뭹 愿由??ㅻ뜑 ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/products`)
    await expect(page.locator('text=?곹뭹 愿由?)).toBeVisible({ timeout: 10_000 })
  })

  test('?꾪꽣 ??3媛??뚮뜑留?(?꾩껜쨌?먮ℓ 以뫢룸퉬?쒖꽦)', async ({ page }) => {
    await page.goto(`${BASE}/products`)
    await expect(page.locator('text=?곹뭹 愿由?)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=?꾩껜').first()).toBeVisible()
    await expect(page.locator('text=?먮ℓ 以?).first()).toBeVisible()
    await expect(page.locator('text=鍮꾪솢??).first()).toBeVisible()
  })

  test('+ ?깅줉 踰꾪듉 ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/products`)
    await expect(page.locator('text=+ ?깅줉').first()).toBeVisible({ timeout: 10_000 })
  })

  test('?곹뭹 紐⑸줉 吏꾩엯 ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/products`)
    await expect(page.locator('text=?곹뭹 愿由?)).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(500)

    expect(errors).toHaveLength(0)
  })

  // ?? B2: ?곹뭹 移대뱶 ?≪뀡 踰꾪듉 ????????????????????????????????????????????????

  test('B2 ???곹뭹 ?덉쓣 ???좉?쨌?섏젙쨌??젣 諭껋? ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/products`)
    await expect(page.locator('text=?곹뭹 愿由?)).toBeVisible({ timeout: 10_000 })

    // ?곹뭹???놁쑝硫?skip
    const hasProduct = await page.locator('text=?먮ℓ 以?).count() > 1 ||
      await page.locator('text=鍮꾪솢??).count() > 1
    if (!hasProduct) return

    // 移대뱶 ??諭껋? ?뺤씤: ?먮ℓ 以?/ 鍮꾪솢??(?좉?), ?섏젙, ??젣
    const toggleBadge = page.locator('text=?먮ℓ 以? text=鍮꾪솢??).or(
      page.locator('text=?섏젙')
    )
    await expect(page.locator('text=?섏젙').first()).toBeVisible()
    await expect(page.locator('text=??젣').first()).toBeVisible()
  })

  test('B2 ???좉? ?대┃ ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/products`)
    await expect(page.locator('text=?곹뭹 愿由?)).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(1_000)

    // ?곹뭹???덉쑝硫??좉? ?대┃ ?쒕룄
    const toggleBadge = page.locator('text=?먮ℓ 以?).nth(1)
      .or(page.locator('text=鍮꾪솢??).nth(1))
    if (await toggleBadge.count() > 0) {
      await toggleBadge.first().click()
      await page.waitForTimeout(500)
    }

    expect(errors).toHaveLength(0)
  })

  test('B2 ???꾪꽣 ???꾪솚 ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/products`)
    await expect(page.locator('text=?곹뭹 愿由?)).toBeVisible({ timeout: 10_000 })

    for (const label of ['?먮ℓ 以?, '鍮꾪솢??, '?꾩껜']) {
      await page.locator(`text=${label}`).first().click()
      await page.waitForTimeout(300)
    }

    expect(errors).toHaveLength(0)
  })
})
