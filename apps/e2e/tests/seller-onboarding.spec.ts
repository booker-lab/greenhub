import { test, expect } from '@playwright/test'
import { loginViaCredentials } from './_helpers/auth'

const BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr'
const API = 'https://api-production-13e7.up.railway.app'

// ?? 鍮꾩씤利?????????????????????????????????????????????????????????????????????

test.describe('????⑤낫????怨듦컻', () => {
  test('誘몄씤利??묎렐 ??login 由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/onboarding`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ?? ?몄쬆 ?????????????????????????????????????????????????????????????????????

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('????⑤낫?????몄쬆', () => {
  test.skip(skipAuth, '?섍꼍蹂??TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD ?꾩슂')

  test.beforeEach(async ({ page }) => {
    await loginViaCredentials(page, BASE, sellerEmail!, sellerPassword!)
  })

  // ?? ?섏씠吏 援ъ“ ???????????????????????????????????????????????????????????

  test('?⑤낫???ㅻ뜑 ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/onboarding`)
    await expect(page.locator('text=?ъ뾽???뺣낫 ?깅줉')).toBeVisible({ timeout: 10_000 })
  })

  test('?꾩닔 ?낅젰 ?꾨뱶 4媛??뚮뜑留?(?곹샇紐끒룸??쒖옄紐끒룹뿰?쎌쿂쨌?뚯옱吏)', async ({ page }) => {
    await page.goto(`${BASE}/onboarding`)
    await expect(page.locator('text=?ъ뾽???뺣낫 ?깅줉')).toBeVisible({ timeout: 10_000 })
    for (const label of ['?곹샇紐?, '??쒖옄紐?, '?곕씫泥?, '?뚯옱吏']) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible()
    }
  })

  // ?? B1: pre-fill ??????????????????????????????????????????????????????????

  test('B1 ??storeId ?덈뒗 怨꾩젙 吏꾩엯 ???곹샇紐??꾨뱶 pre-fill', async ({ page }) => {
    await page.goto(`${BASE}/onboarding`)
    await expect(page.locator('text=?ъ뾽???뺣낫 ?깅줉')).toBeVisible({ timeout: 10_000 })

    // API ?묐떟 ?湲?(pre-fill? useEffect 鍮꾨룞湲?
    await page.waitForTimeout(2_000)

    // ?곹샇紐?input??鍮꾩뼱?덉? ?딆븘????    const nameInput = page.locator('input[name="name"]')
    await expect(nameInput).toBeVisible()
    const value = await nameInput.inputValue()
    expect(value.length).toBeGreaterThan(0)
  })

  test('B1 ??pre-fill ?????섏젙 媛??, async ({ page }) => {
    await page.goto(`${BASE}/onboarding`)
    await expect(page.locator('text=?ъ뾽???뺣낫 ?깅줉')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(2_000)

    const nameInput = page.locator('input[name="name"]')
    const original = await nameInput.inputValue()

    // ?섏젙 媛???щ? ?뺤씤
    await nameInput.fill(`${original} ?섏젙?뚯뒪??)
    const modified = await nameInput.inputValue()
    expect(modified).toContain('?섏젙?뚯뒪??)

    // ?먮옒 媛믪쑝濡?蹂듭썝
    await nameInput.fill(original)
  })

  test('?⑤낫??吏꾩엯 ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/onboarding`)
    await expect(page.locator('text=?ъ뾽???뺣낫 ?깅줉')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(2_000)

    expect(errors).toHaveLength(0)
  })
})

// ?? B1: API GET /stores/:storeId ??????????????????????????????????????????????

test.describe('B1 ??GET /stores/:storeId API', () => {
  test.skip(skipAuth, '?섍꼍蹂??TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD ?꾩슂')

  let accessToken: string
  const TEST_STORE_ID = '9b2cb652-ff77-46b9-a773-e1efa78fb763'

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API}/auth/login`, {
      data: { email: sellerEmail, password: sellerPassword },
    })
    const body = await res.json()
    accessToken = body.accessToken
  })

  test('GET /stores/:storeId ??200 + ?ㅽ넗???곗씠??諛섑솚', async ({ request }) => {
    const res = await request.get(`${API}/stores/${TEST_STORE_ID}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('id', TEST_STORE_ID)
    expect(body).toHaveProperty('name')
    expect(body.name.length).toBeGreaterThan(0)
  })

  test('GET /stores/:storeId ??誘몄씤利???401', async ({ request }) => {
    const res = await request.get(`${API}/stores/${TEST_STORE_ID}`)
    expect(res.status()).toBe(401)
  })

  test('GET /stores/:storeId ?????storeId ?묎렐 ??403', async ({ request }) => {
    const res = await request.get(`${API}/stores/00000000-0000-0000-0000-000000000000`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    // 議댁옱?섏? ?딆쑝硫?404, ????뚯쑀硫?403
    expect([403, 404]).toContain(res.status())
  })
})
