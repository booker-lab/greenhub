import { test, expect } from '@playwright/test'

const BASE = process.env['DRIVER_BASE'] ?? 'https://driver.greenlove.co.kr'

test.describe('?쒕씪?대쾭 ??, () => {
  test('猷⑦듃 ?묎렐 ??/board濡?由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(BASE)
    await expect(page).toHaveURL(/board|login|signin/, { timeout: 10_000 })
  })

  test('誘몄씤利??곹깭?먯꽌 /board ?묎렐 ??濡쒓렇?몄쑝濡?由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/board`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('濡쒓렇???섏씠吏 ?뺤긽 ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await expect(page.locator('body')).toBeVisible()
    // ?쒕씪?대쾭 ?깆? 移댁뭅??OAuth ?꾩슜
    await expect(page.locator('text=移댁뭅?ㅻ줈 ?쒖옉?섍린')).toBeVisible()
    await expect(page.locator('text=Green Love ?쒕씪?대쾭')).toBeVisible()
  })
})

// TEST_DRIVER_EMAIL / TEST_DRIVER_PASSWORD ?섍꼍蹂???명똿 ???쒖꽦??const driverEmail = process.env['TEST_DRIVER_EMAIL']
const driverPassword = process.env['TEST_DRIVER_PASSWORD']

test.describe('?쒕씪?대쾭 諛곗넚 蹂대뱶 (?몄쬆 ?꾩슂)', () => {
  test.skip(!driverEmail || !driverPassword, '?섍꼍蹂??TEST_DRIVER_EMAIL / TEST_DRIVER_PASSWORD ?꾩슂')

  test('濡쒓렇????諛곗넚 蹂대뱶 吏꾩엯', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await page.fill('input[type="email"]', driverEmail!)
    await page.fill('input[type="password"]', driverPassword!)
    await page.click('button[type="submit"]')
    await page.waitForURL(/board/, { timeout: 15_000 })
    await expect(page.locator('body')).toBeVisible()
  })
})
