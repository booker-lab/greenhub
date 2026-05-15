import { test, expect } from '@playwright/test'

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

// E2E_TEST=true ?쒖뿉留??대찓???쇱씠 ?뚮뜑留곷맖 (NEXT_PUBLIC_E2E_TEST 寃뚯씠??
const skipEmailForm = process.env['E2E_TEST'] !== 'true'

test.describe('Consumer ???몄쬆 ?뚮줈??, () => {
  test('/login ??移댁뭅??濡쒓렇??踰꾪듉 ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Green Love')).toBeVisible()
    await expect(page.getByText('移댁뭅?ㅻ줈 ?쒖옉?섍린')).toBeVisible()
  })

  test('/login ???대찓?????뚮뜑留?(E2E_TEST ?꾩슜)', async ({ page }) => {
    test.skip(skipEmailForm, 'NEXT_PUBLIC_E2E_TEST=true ?ㅼ젙 諛?諛고룷 ?꾩슂')
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByLabel('?대찓??)).toBeVisible()
    await expect(page.getByLabel('鍮꾨?踰덊샇')).toBeVisible()
    await expect(page.getByRole('button', { name: '濡쒓렇?? })).toBeVisible()
  })

  test('/login ???섎せ???대찓???뺤떇 ??釉뚮씪?곗? ?좏슚???먮윭 (submit 李⑤떒)', async ({ page }) => {
    test.skip(skipEmailForm, 'NEXT_PUBLIC_E2E_TEST=true ?ㅼ젙 諛?諛고룷 ?꾩슂')
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')

    await page.getByLabel('?대찓??).fill('invalid-email')
    await page.getByLabel('鍮꾨?踰덊샇').fill('password123')
    await page.getByRole('button', { name: '濡쒓렇?? }).click()

    // HTML5 type="email" ?좏슚??寃?щ줈 form submit??李⑤떒?섏뼱 URL 蹂寃??놁쓬
    await expect(page).toHaveURL(/\/login/)
  })

  test('/login ???섎せ???먭꺽利앸챸 ???먮윭 硫붿떆吏 ?쒖떆', async ({ page }) => {
    test.skip(skipEmailForm, 'NEXT_PUBLIC_E2E_TEST=true ?ㅼ젙 諛?諛고룷 ?꾩슂')
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')

    await page.getByLabel('?대찓??).fill('wrong@example.com')
    await page.getByLabel('鍮꾨?踰덊샇').fill('wrongpassword')
    await page.getByRole('button', { name: '濡쒓렇?? }).click()

    await expect(
      page.getByText('?대찓???먮뒗 鍮꾨?踰덊샇媛 ?щ컮瑜댁? ?딆뒿?덈떎.')
    ).toBeVisible({ timeout: 10_000 })
  })

  test('/cart ??鍮꾨줈洹몄씤 ??/login?쇰줈 由щ뵒?됲듃', async ({ page }) => {
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText('Green Love')).toBeVisible()
  })

  test('/checkout ??鍮꾨줈洹몄씤 ??/login?쇰줈 由щ뵒?됲듃', async ({ page }) => {
    await page.goto(`${BASE}/checkout?from=cart`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/login/)
  })

  test('/login ??callbackUrl ?뚮씪誘명꽣 ?ㅽ뵂 由щ뵒?됲듃 諛⑹뼱', async ({ page }) => {
    await page.goto(`${BASE}/login?callbackUrl=https://evil.com`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Green Love')).toBeVisible()
  })
})
