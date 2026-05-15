import { test, expect } from '@playwright/test'
import { loginViaCredentials } from './_helpers/auth'

const BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr'

// ?? 鍮꾩씤利?????????????????????????????????????????????????????????????????????

test.describe('???二쇰Ц ?곸꽭 ??怨듦컻', () => {
  test('誘몄씤利??묎렐 ??login 由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/orders/fake-order-id`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ?? ?몄쬆 ?????????????????????????????????????????????????????????????????????

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('???二쇰Ц ?곸꽭 ???몄쬆', () => {
  test.skip(skipAuth, '?섍꼍蹂??TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD ?꾩슂')

  test.beforeEach(async ({ page }) => {
    await loginViaCredentials(page, BASE, sellerEmail!, sellerPassword!)
  })

  // ?? G2: ?곹뭹紐??쒖떆 ???????????????????????????????????????????????????????

  test('G2 ??二쇰Ц ?곸꽭 ?곹뭹?뺣낫 ?쇰꺼??"?곹뭹紐??쇰줈 ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })

    // 二쇰Ц 移대뱶媛 ?덉쑝硫?泥?踰덉㎏ ?대┃, ?놁쑝硫?skip
    const orderCard = page.locator('[data-testid="order-card"]').or(
      page.locator('text=二쇰Ц #').first()
    )
    const hasOrder = await orderCard.count() > 0
    if (!hasOrder) {
      test.info().annotations.push({ type: 'skip-reason', description: '?뚯뒪??怨꾩젙??二쇰Ц ?놁쓬' })
      return
    }

    await orderCard.first().click()
    await expect(page.locator('text=二쇰Ц ?곸꽭')).toBeVisible({ timeout: 10_000 })

    // "?곹뭹 ID" ?쇰꺼???щ씪吏怨?"?곹뭹紐??쇰줈 援먯껜?섏뿀?붿? ?뺤씤
    await expect(page.locator('text=?곹뭹紐?).first()).toBeVisible()
    await expect(page.locator('text=?곹뭹 ID')).not.toBeVisible()
  })

  // ?? preparedAt: 鍮좊Ⅸ ?좏깮吏 UI ????????????????????????????????????????????

  test('preparedAt ??以鍮??쒖옉 踰꾪듉 ?대┃ ??鍮좊Ⅸ ?좏깮吏 3媛??뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })

    const orderCard = page.locator('text=二쇰Ц #').first()
    const hasOrder = await orderCard.count() > 0
    if (!hasOrder) return

    await orderCard.click()
    await expect(page.locator('text=二쇰Ц ?곸꽭')).toBeVisible({ timeout: 10_000 })

    // "以鍮??쒖옉" 踰꾪듉???덈뒗 ?곹깭(ACCEPTED/CONFIRMED)?먯꽌留?寃利?    const prepareBtn = page.locator('text=以鍮??쒖옉')
    const canPrepare = await prepareBtn.count() > 0
    if (!canPrepare) return

    await prepareBtn.click()

    // 鍮좊Ⅸ ?좏깮吏 3媛?踰꾪듉 紐⑤몢 ?뚮뜑留??뺤씤
    await expect(page.locator('text=?ㅻ뒛 ?ㅽ썑 2??)).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('text=?ㅻ뒛 ?ㅽ썑 4??)).toBeVisible()
    await expect(page.locator('text=?댁씪 ?ㅼ쟾 9??)).toBeVisible()

    // datetime-local input???놁뼱????(?먭린 ?뺤씤)
    await expect(page.locator('input[type="datetime-local"]')).not.toBeVisible()
  })

  test('preparedAt ???좏깮吏 ?대┃ ??"?좏깮??" ?띿뒪???쒖떆', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })

    const orderCard = page.locator('text=二쇰Ц #').first()
    if (await orderCard.count() === 0) return

    await orderCard.click()
    await expect(page.locator('text=二쇰Ц ?곸꽭')).toBeVisible({ timeout: 10_000 })

    const prepareBtn = page.locator('text=以鍮??쒖옉')
    if (await prepareBtn.count() === 0) return

    await prepareBtn.click()
    await expect(page.locator('text=?ㅻ뒛 ?ㅽ썑 2??)).toBeVisible({ timeout: 5_000 })

    await page.locator('text=?ㅻ뒛 ?ㅽ썑 2??).click()
    await expect(page.locator('text=?좏깮??')).toBeVisible()
  })

  test('preparedAt ???좏깮吏 ?ы겢由???deselect (?덈궡臾?蹂듭썝)', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })

    const orderCard = page.locator('text=二쇰Ц #').first()
    if (await orderCard.count() === 0) return

    await orderCard.click()
    await expect(page.locator('text=二쇰Ц ?곸꽭')).toBeVisible({ timeout: 10_000 })

    const prepareBtn = page.locator('text=以鍮??쒖옉')
    if (await prepareBtn.count() === 0) return

    await prepareBtn.click()
    await expect(page.locator('text=?ㅻ뒛 ?ㅽ썑 2??)).toBeVisible({ timeout: 5_000 })

    await page.locator('text=?ㅻ뒛 ?ㅽ썑 2??).click()
    await expect(page.locator('text=?좏깮??')).toBeVisible()

    // ?ы겢由???deselect ???덈궡臾?蹂듭썝
    await page.locator('text=?ㅻ뒛 ?ㅽ썑 2??).click()
    await expect(page.locator('text=?좏깮?섏? ?딆븘??)).toBeVisible()
  })

  test('二쇰Ц ?곸꽭 吏꾩엯 ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=二쇰Ц 愿由?)).toBeVisible({ timeout: 10_000 })

    const orderCard = page.locator('text=二쇰Ц #').first()
    if (await orderCard.count() === 0) {
      expect(errors).toHaveLength(0)
      return
    }

    await orderCard.click()
    await expect(page.locator('text=二쇰Ц ?곸꽭')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(500)

    expect(errors).toHaveLength(0)
  })
})
