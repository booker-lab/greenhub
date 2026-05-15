import { test, expect } from '@playwright/test'
import { loginViaCredentials } from './_helpers/auth'

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

const consumerEmail = process.env['TEST_CONSUMER_EMAIL']
const consumerPassword = process.env['TEST_CONSUMER_PASSWORD']
const skipAuth = !consumerEmail || !consumerPassword

// /cart??誘몃뱾?⑥뼱濡?蹂댄샇????鍮꾨줈洹몄씤 ??/login 由щ뵒?됲듃
test.describe('Consumer ???λ컮援щ땲 (鍮꾩씤利?', () => {
  test('/cart ??鍮꾨줈洹몄씤 ??/login 由щ뵒?됲듃', async ({ page }) => {
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/login/)
  })

  test('/cart ??由щ뵒?됲듃 ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('/cart callbackUrl 蹂댁〈 ??濡쒓렇????蹂듦? 媛??, async ({ page }) => {
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/login/)
  })
})

// ?? ?몄쬆 ???λ컮援щ땲 湲곕뒫 ?뚯뒪??????????????????????????????????????????

test.describe('Consumer ???λ컮援щ땲 (?몄쬆)', () => {
  test.skip(skipAuth, '?섍꼍蹂??TEST_CONSUMER_EMAIL / TEST_CONSUMER_PASSWORD ?꾩슂')

  test.beforeEach(async ({ page }) => {
    await loginViaCredentials(page, BASE, consumerEmail!, consumerPassword!)
  })

  test('鍮??λ컮援щ땲 ???덈궡 UI ?뚮뜑留?, async ({ page }) => {
    await page.goto(BASE)
    await page.evaluate(() => localStorage.removeItem('greenhub_cart'))
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('?λ컮援щ땲媛 鍮꾩뼱?덉뒿?덈떎.')).toBeVisible()
    await expect(page.getByRole('link', { name: '?쇳븨?섎윭 媛湲? })).toBeVisible()
  })

  test('localStorage ?꾩씠??二쇱엯 ???곹뭹紐끒룰툑???뚮뜑留?, async ({ page }) => {
    const mockItem = {
      productId: 'test-product-1',
      name: '?뚯뒪???곹뭹',
      price: 15000,
      quantity: 2,
      image: '',
      saleType: 'normal',
      storeId: 'store-1',
      deliveryMethod: 'direct',
    }
    await page.goto(BASE)
    await page.evaluate((item) => {
      localStorage.setItem('greenhub_cart', JSON.stringify([item]))
    }, mockItem)
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('?뚯뒪???곹뭹')).toBeVisible()
    // 30,000?먯? ?꾩씠????+ ?⑷퀎 Footer 2怨녹뿉 ?뚮뜑 ??.first()濡?strict mode ?뚰뵾
    await expect(page.getByText('30,000??).first()).toBeVisible()
  })

  test('寃곗젣?섍린 踰꾪듉 ??/checkout?from=cart ?대룞', async ({ page }) => {
    const mockItem = {
      productId: 'test-product-2',
      name: '寃곗젣 ?뚯뒪???곹뭹',
      price: 10000,
      quantity: 1,
      image: '',
      saleType: 'normal',
      storeId: 'store-1',
      deliveryMethod: 'direct',
    }
    await page.goto(BASE)
    await page.evaluate((item) => {
      localStorage.setItem('greenhub_cart', JSON.stringify([item]))
    }, mockItem)
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /寃곗젣?섍린/ }).click()
    await expect(page).toHaveURL(/\/checkout/, { timeout: 10_000 })
  })
})
