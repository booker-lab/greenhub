import { test, expect } from '@playwright/test'
import { loginViaCredentials } from './_helpers/auth'

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

const consumerEmail = process.env['TEST_CONSUMER_EMAIL']
const consumerPassword = process.env['TEST_CONSUMER_PASSWORD']
const skipAuth = !consumerEmail || !consumerPassword

// /mypage/* ??誘몃뱾?⑥뼱濡?蹂댄샇????鍮꾨줈洹몄씤 ??/login 由щ뵒?됲듃
test.describe('Consumer ??留덉씠?섏씠吏 (鍮꾩씤利?', () => {
  test('/mypage ??鍮꾨줈洹몄씤 ??/login 由щ뵒?됲듃', async ({ page }) => {
    await page.goto(`${BASE}/mypage`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/login/)
  })

  test('/mypage ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/mypage`)
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('/mypage/addresses ??鍮꾨줈洹몄씤 ??/login 由щ뵒?됲듃', async ({ page }) => {
    await page.goto(`${BASE}/mypage/addresses`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/login/)
  })

  test('/mypage/notifications ??鍮꾨줈洹몄씤 ??/login 由щ뵒?됲듃', async ({ page }) => {
    await page.goto(`${BASE}/mypage/notifications`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/login/)
  })

  test('/mypage/orders/[id] ??鍮꾨줈洹몄씤 ??/login 由щ뵒?됲듃', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/mypage/orders/nonexistent-order-id-00000`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/login/)
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad') && !e.includes('404')
    )
    expect(critical).toHaveLength(0)
  })

  test('濡쒓렇???섏씠吏 ??BottomNav MY ???몄텧', async ({ page }) => {
    await page.goto(`${BASE}/mypage`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('MY')).toBeVisible()
  })
})

// ?? ?몄쬆 ??留덉씠?섏씠吏 ?뚯뒪???????????????????????????????????????????????

test.describe('Consumer ??留덉씠?섏씠吏 (?몄쬆)', () => {
  test.skip(skipAuth, '?섍꼍蹂??TEST_CONSUMER_EMAIL / TEST_CONSUMER_PASSWORD ?꾩슂')

  test.beforeEach(async ({ page }) => {
    await loginViaCredentials(page, BASE, consumerEmail!, consumerPassword!)
  })

  test('?꾨줈?????대찓???쒖떆', async ({ page }) => {
    await page.goto(`${BASE}/mypage`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/@/)).toBeVisible({ timeout: 10_000 })
  })

  test('二쇰Ц 紐⑸줉 ?뚮뜑留??먮뒗 鍮??곹깭 ?덈궡', async ({ page }) => {
    await page.goto(`${BASE}/mypage`)
    await page.waitForLoadState('networkidle')
    const empty = page.getByText('二쇰Ц ?댁뿭???놁뒿?덈떎')
    const hasOrders = (await page.locator('[data-testid="order-card"]').count()) > 0
    if (!hasOrders) await expect(empty).toBeVisible({ timeout: 10_000 })
  })

  test('/mypage/addresses ??JS ?먮윭 ?놁씠 ?뚮뜑留?, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/mypage/addresses`)
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
    await expect(page.locator('body')).toBeVisible()
  })

  test('/mypage/notifications ??JS ?먮윭 ?놁씠 ?뚮뜑留?, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/mypage/notifications`)
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
    await expect(page.locator('body')).toBeVisible()
  })
})
