import { test, expect } from '@playwright/test'
import { loginViaCredentials } from './_helpers/auth'

const BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr'

test.describe('???諛곕꼫 愿由?, () => {
  test('誘몄씤利??묎렐 ??濡쒓렇???섏씠吏濡?由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/admin/banner`)
    // ?몄쬆?섏? ?딆쑝硫?濡쒓렇???섏씠吏濡?redirect ?섏뼱????    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('濡쒓렇???섏씠吏 ?뺤긽 ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await expect(page.locator('body')).toBeVisible()
    // 濡쒓렇?????붿냼 議댁옱 ?뺤씤
    const input = page.locator('input[type="email"], input[type="text"]')
    await expect(input.first()).toBeVisible()
  })
})

// ?ㅼ젣 濡쒓렇?????좉? 寃利앹? ?꾨옒 釉붾줉?먯꽌 ?뺤옣
// TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD ?섍꼍蹂???명똿 ???쒖꽦??const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']

test.describe('???諛곕꼫 ?좉? (?몄쬆 ?꾩슂)', () => {
  // admin 沅뚰븳 怨꾩젙 ?꾩슂 ??TEST_SELLER_EMAIL? seller role?대?濡?/admin/banner ?묎렐 遺덇?
  test.skip(true, 'admin 沅뚰븳 怨꾩젙 ?꾩슂 (TEST_SELLER_EMAIL? seller role)')

  test('諛곕꼫 ?쒖꽦???좉? ?대┃ ???먮윭 ?놁쓬', async ({ page }) => {
    await loginViaCredentials(page, BASE, sellerEmail!, sellerPassword!)

    await page.goto(`${BASE}/admin/banner`)
    await page.waitForSelector('text=?덉뼱濡?諛곕꼫 愿由?, { timeout: 10_000 })

    // ?좉? ?대┃
    const toggle = page.locator('role=switch')
    await toggle.click()

    // JS ?먮윭媛 ?놁뼱????    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.waitForTimeout(500)
    expect(errors.filter(e => e.includes('Cannot read properties of null'))).toHaveLength(0)
  })
})
