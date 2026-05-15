import { test, expect } from '@playwright/test'
import { loginViaCredentials } from './_helpers/auth'

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

const consumerEmail = process.env['TEST_CONSUMER_EMAIL']
const consumerPassword = process.env['TEST_CONSUMER_PASSWORD']
const skipAuth = !consumerEmail || !consumerPassword

// /checkout, /order/* ??誘몃뱾?⑥뼱濡?蹂댄샇????鍮꾨줈洹몄씤 ??/login 由щ뵒?됲듃
test.describe('Consumer ??寃곗젣 (鍮꾩씤利?', () => {
  test('/checkout ??鍮꾨줈洹몄씤 ??/login 由щ뵒?됲듃', async ({ page }) => {
    await page.goto(`${BASE}/checkout?from=cart`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/login/)
  })

  test('/checkout ??由щ뵒?됲듃 ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/checkout?from=cart`)
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('/order/success ??鍮꾨줈洹몄씤 ??/login 由щ뵒?됲듃', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/order/success?orderId=test-order-000`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/login/)
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })
})

// ?? ?몄쬆 ??寃곗젣 UI ?뚯뒪??????????????????????????????????????????????????

test.describe('Consumer ??寃곗젣 (?몄쬆)', () => {
  test.skip(skipAuth, '?섍꼍蹂??TEST_CONSUMER_EMAIL / TEST_CONSUMER_PASSWORD ?꾩슂')

  test.beforeEach(async ({ page }) => {
    await loginViaCredentials(page, BASE, consumerEmail!, consumerPassword!)
  })

  test('/checkout ??寃곗젣 UI ?듭떖 ?붿냼 ?뚮뜑留?, async ({ page }) => {
    const mockCartItems = [
      {
        productId: 'checkout-test-1',
        name: '泥댄겕?꾩썐 ?뚯뒪???곹뭹',
        price: 25000,
        quantity: 2,
        image: '',
        saleType: 'normal',
        storeId: 'store-1',
        deliveryMethod: 'direct',
      },
    ]
    await page.goto(BASE)
    await page.evaluate((items) => {
      sessionStorage.setItem('checkout_cart', JSON.stringify(items))
    }, mockCartItems)
    await page.goto(`${BASE}/checkout?from=cart`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('諛곗넚吏')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('寃곗젣 ?섎떒')).toBeVisible()
    // exact: true ??'移댁뭅?ㅽ럹?대줈 寃곗젣?섍린' 踰꾪듉怨?以묐났 留ㅼ묶 諛⑹?
    await expect(page.getByText('移댁뭅?ㅽ럹??, { exact: true })).toBeVisible()
  })

  test('/checkout ??sessionStorage 移댄듃 ?곗씠????二쇰Ц ?붿빟 ?곹뭹紐??쒖떆', async ({ page }) => {
    const mockCartItems = [
      {
        productId: 'checkout-test-2',
        name: '二쇰Ц?붿빟 ?뚯뒪???곹뭹',
        price: 12000,
        quantity: 1,
        image: '',
        saleType: 'normal',
        storeId: 'store-1',
        deliveryMethod: 'direct',
      },
    ]
    await page.goto(BASE)
    await page.evaluate((items) => {
      sessionStorage.setItem('checkout_cart', JSON.stringify(items))
    }, mockCartItems)
    await page.goto(`${BASE}/checkout?from=cart`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('二쇰Ц?붿빟 ?뚯뒪???곹뭹')).toBeVisible({ timeout: 10_000 })
  })

  test('/checkout ??鍮?移댄듃 ?곹깭 ??寃곗젣?섍린 踰꾪듉 鍮꾪솢?깊솕 ?먮뒗 ?덈궡 ?쒖떆', async ({ page }) => {
    await page.goto(BASE)
    await page.evaluate(() => sessionStorage.removeItem('checkout_cart'))
    await page.goto(`${BASE}/checkout?from=cart`)
    await page.waitForLoadState('networkidle')
    const payBtn = page.getByRole('button', { name: /寃곗젣?섍린/ })
    const isEmpty = (await payBtn.count()) === 0 || (await payBtn.isDisabled())
    expect(isEmpty).toBeTruthy()
  })
})
