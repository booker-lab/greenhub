import { test, expect } from '@playwright/test'

const BASE = process.env['DRIVER_BASE'] ?? 'https://driver.greenlove.co.kr'

// ?? 怨듦컻 ?묎렐 媛???섏씠吏 ??????????????????????????????????????????

test.describe('?쒕씪?대쾭 ?붿옄???쒖뒪????濡쒓렇???섏씠吏', () => {
  test('濡쒓렇???섏씠吏 ?뺤긽 ?뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await expect(page.locator('body')).toBeVisible()
    await expect(page.locator('text=Green Love ?쒕씪?대쾭')).toBeVisible()
    await expect(page.locator('text=?쒕씪?대쾭 怨꾩젙?쇰줈 濡쒓렇?명븯?몄슂')).toBeVisible()
    await expect(page.locator('text=移댁뭅?ㅻ줈 ?쒖옉?섍린')).toBeVisible()
  })

  test('濡쒓렇???섏씠吏 ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')
    expect(errors.filter((e) => !e.includes('hydration'))).toHaveLength(0)
  })

  test('濡쒓렇???섏씠吏 ??移댁뭅???덉쇅 ?됱긽(#FEE500) ?좎?', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    const kakaoBtn = page.locator('button[type="submit"]').first()
    await expect(kakaoBtn).toBeVisible()
    const bg = await kakaoBtn.evaluate((el) =>
      (el as HTMLElement).style.backgroundColor
    )
    // 移댁뭅??釉뚮옖??而щ윭 #FEE500 蹂댁〈 ?뺤씤
    expect(bg.toLowerCase()).toMatch(/fee500|rgb\(254,\s*229,\s*0\)/)
  })

  test('濡쒓렇???섏씠吏 ??援?green-* CSS 蹂??誘몄궗??, async ({ page }) => {
    await page.goto(`${BASE}/login`)
    // --mantine-color-* ??Mantine 而댄룷?뚰듃 ?대? 二쇱엯 蹂?섏씠誘濡??덉슜
    // ?곕━ 肄붾뱶?먯꽌 吏곸젒 ?ъ슜??援щ쾭??--green-* 蹂?섎쭔 ?꾨컲?쇰줈 ?먯젙
    const violation = await page.evaluate(() => {
      const all = document.querySelectorAll<HTMLElement>('[style]')
      const bad: string[] = []
      for (const el of all) {
        const s = el.getAttribute('style') ?? ''
        if (
          s.includes('--green-primary') ||
          s.includes('--green-pale') ||
          s.includes('--green-dark')
        ) {
          bad.push(s)
        }
      }
      return bad
    })
    expect(violation).toHaveLength(0)
  })

  test('濡쒓렇???섏씠吏 ??Paper border ?곸슜 (shadow ?쒓굅)', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    // Paper 而⑦뀒?대꼫: boxShadow ?녾퀬 border ?덉뼱????    const paperEl = await page.evaluate(() => {
      const papers = document.querySelectorAll<HTMLElement>('[style*="border"]')
      for (const el of papers) {
        const s = el.style
        if (s.border && !s.boxShadow) return true
      }
      return false
    })
    expect(paperEl).toBe(true)
  })
})

// ?? 由щ뵒?됱뀡 寃利??????????????????????????????????????????????????

test.describe('?쒕씪?대쾭 ?붿옄???쒖뒪?????쇱슦??, () => {
  test('誘몄씤利???/board ?묎렐 ??login 由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/board`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('誘몄씤利???/map ?묎렐 ??login 由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/map`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('誘몄씤利???/profile ?묎렐 ??login 由щ뵒?됱뀡', async ({ page }) => {
    await page.goto(`${BASE}/profile`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ?? ?몄쬆 ???듭떖 ?붾㈃ 寃利?????????????????????????????????????????
// ?쒕씪?대쾭 ?깆? 移댁뭅??OAuth ?꾩슜 ???먮룞 濡쒓렇???뚯뒪?몃뒗 ?몄뀡 荑좏궎 二쇱엯 諛⑹떇 ?꾩슂
// DRIVER_SESSION_COOKIE ?섍꼍蹂???명똿 ???쒖꽦??
const sessionCookie = process.env['DRIVER_SESSION_COOKIE']

test.describe('?쒕씪?대쾭 ?붿옄???쒖뒪?????몄쬆 ?붾㈃ (?몄뀡 二쇱엯)', () => {
  test.skip(!sessionCookie, '?섍꼍蹂??DRIVER_SESSION_COOKIE ?꾩슂')

  test.beforeEach(async ({ page, context }) => {
    // next-auth ?몄뀡 荑좏궎 二쇱엯
    const cookies = JSON.parse(sessionCookie!) as Array<{
      name: string; value: string; domain?: string; path?: string
    }>
    await context.addCookies(
      cookies.map((c) => ({ ...c, domain: 'driver.greenlove.co.kr', path: '/' }))
    )
  })

  test('諛곗넚 蹂대뱶 ???ㅻ뜑 + ???뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/board`)
    await expect(page.locator('text=?ㅻ뒛 諛곗넚')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=?섍굅 ?湲?)).toBeVisible()
    await expect(page.locator('text=諛곗넚 以?)).toBeVisible()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.waitForTimeout(500)
    expect(errors.filter((e) => !e.includes('hydration'))).toHaveLength(0)
  })

  test('諛곗넚 蹂대뱶 ??援?Mantine 蹂??誘몄궗??, async ({ page }) => {
    await page.goto(`${BASE}/board`)
    await page.waitForLoadState('networkidle')
    const violation = await page.evaluate(() => {
      const all = document.querySelectorAll<HTMLElement>('[style]')
      const bad: string[] = []
      for (const el of all) {
        const s = el.getAttribute('style') ?? ''
        if (
          s.includes('--mantine-color-') ||
          s.includes('--green-primary') ||
          s.includes('--green-pale')
        ) {
          bad.push(s)
        }
      }
      return bad
    })
    expect(violation).toHaveLength(0)
  })

  test('諛곗넚 蹂대뱶 ??BottomNav borderTop ?곸슜 (boxShadow ?쒓굅)', async ({ page }) => {
    await page.goto(`${BASE}/board`)
    await page.waitForLoadState('networkidle')
    const result = await page.evaluate(() => {
      const nav = document.querySelector('nav')
      if (!nav) return { hasNav: false, hasBorderTop: false, hasBoxShadow: false }
      const s = (nav as HTMLElement).style
      return {
        hasNav: true,
        hasBorderTop: !!s.borderTop,
        hasBoxShadow: !!s.boxShadow,
      }
    })
    expect(result.hasNav).toBe(true)
    expect(result.hasBorderTop).toBe(true)
    expect(result.hasBoxShadow).toBe(false)
  })

  test('吏???섏씠吏 ???뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/map`)
    await expect(page.locator('text=?ㅻ뒛 諛곗넚 寃쎈줈')).toBeVisible({ timeout: 10_000 })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.waitForTimeout(500)
    expect(errors.filter((e) => !e.includes('hydration'))).toHaveLength(0)
  })

  test('???뺣낫 ???뚮뜑留?, async ({ page }) => {
    await page.goto(`${BASE}/profile`)
    await expect(page.locator('text=???뺣낫')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=?곌껐??怨꾩젙')).toBeVisible()
    await expect(page.locator('text=??踰꾩쟾')).toBeVisible()
    await expect(page.locator('text=濡쒓렇?꾩썐')).toBeVisible()
  })
})
