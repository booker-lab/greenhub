import { test, expect } from '@playwright/test'

/**
 * DS 由ы뙥?좊쭅 T0~T9 ?뚭? 寃利?(2026-05-02)
 * - ?섎뱶肄붾뵫 hex/?レ옄媛???CSS 蹂???꾪솚 ???뚮뜑留??뺤긽 ?щ?
 * - 媛??섏씠吏 JS ?먮윭 ?놁쓬 + ?듭떖 UI ?붿냼 媛?쒖꽦 ?뺤씤
 */

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

// ?? T1: mypage fallback ??#999 ??var(--color-text-disabled) ??????????

test.describe('Consumer DS ??mypage ?섏씠吏援?, () => {
  const mypageRoutes = ['/mypage', '/mypage/addresses', '/mypage/notifications']

  for (const route of mypageRoutes) {
    test(`${route} ??JS ?먮윭 ?놁쓬`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(BASE + route)
      await page.waitForLoadState('networkidle')
      const critical = errors.filter(
        (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
      )
      expect(critical).toHaveLength(0)
    })
  }

  test('mypage ??--color-text-disabled ?좏겙 ?뺤긽 ?댁꽍', async ({ page }) => {
    await page.goto(BASE + '/mypage')
    await page.waitForLoadState('networkidle')
    const tokenValue = await page.evaluate(() => {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--color-text-disabled')
        .trim()
    })
    expect(tokenValue).toBeTruthy()
    expect(tokenValue).not.toBe('')
  })
})

// ?? T2: cart ??borderRadius: 8 ??var(--radius-sm) ???????????????????

test.describe('Consumer DS ??cart ?섏씠吏', () => {
  test('cart ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(BASE + '/cart')
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('cart ??--radius-sm ?좏겙 ?뺤긽 ?댁꽍', async ({ page }) => {
    await page.goto(BASE + '/cart')
    await page.waitForLoadState('networkidle')
    const tokenValue = await page.evaluate(() => {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--radius-sm')
        .trim()
    })
    expect(tokenValue).toBeTruthy()
    expect(tokenValue).not.toBe('')
  })
})

// ?? T3: category ??fontSize/fontWeight ??var() ???????????????????????

test.describe('Consumer DS ??category ?섏씠吏', () => {
  test('category ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(BASE + '/category')
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('category ????踰꾪듉 ?뚮뜑留??뺤긽', async ({ page }) => {
    await page.goto(BASE + '/category')
    await page.waitForLoadState('networkidle')
    const tabs = page.locator('button').first()
    await expect(tabs).toBeVisible()
  })

  test('category ??--font-size-sm ?좏겙 ?뺤긽 ?댁꽍 (??5px)', async ({ page }) => {
    await page.goto(BASE + '/category')
    const tokenValue = await page.evaluate(() => {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--font-size-sm')
        .trim()
    })
    expect(tokenValue).toBeTruthy()
    const px = parseInt(tokenValue)
    expect(px).toBeGreaterThanOrEqual(15)
  })
})

// ?? T4~T6: mypage ?섏쐞 ?대씪?댁뼵??而댄룷?뚰듃 ??????????????????????????

test.describe('Consumer DS ??mypage ?대씪?댁뼵??而댄룷?뚰듃', () => {
  test('mypage ???ㅻ뜑 紐⑸줉 ?곸뿭 ?뚮뜑留??뺤긽 (borderRadius ?좏겙)', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(BASE + '/mypage')
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('mypage/addresses ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(BASE + '/mypage/addresses')
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })
})

// ?? T7~T8: ?곹뭹 ?곸꽭 而댄룷?뚰듃 ???????????????????????????????????????

test.describe('Consumer DS ???곹뭹 ?곸꽭 ?섏씠吏', () => {
  test('products/[id] ??JS ?먮윭 ?놁쓬', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')

    const firstProductLink = page.locator('a[href^="/products/"]').first()
    const count = await firstProductLink.count()

    if (count > 0) {
      const href = await firstProductLink.getAttribute('href')
      await page.goto(BASE + href)
      await page.waitForLoadState('load')
    } else {
      await page.goto(BASE + '/products/test')
      await page.waitForLoadState('load')
    }

    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad') && !e.includes('404')
    )
    expect(critical).toHaveLength(0)
  })

  test('products/[id] ??--radius-sm/--fw-bold/--font-size-md ?좏겙 紐⑤몢 ?댁꽍', async ({ page }) => {
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')

    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement)
      return {
        radiusSm: cs.getPropertyValue('--radius-sm').trim(),
        fwBold: cs.getPropertyValue('--fw-bold').trim(),
        fontSizeMd: cs.getPropertyValue('--font-size-md').trim(),
      }
    })

    expect(tokens.radiusSm).toBeTruthy()
    expect(tokens.fwBold).toBeTruthy()
    expect(tokens.fontSizeMd).toBeTruthy()
  })
})

// ?? ?덉쇅 ??ぉ 怨듭떇 ?뺤씤 ???????????????????????????????????????????????

test.describe('Consumer DS ??怨듭떇 ?덉쇅 compact 而댄룷?뚰듃', () => {
  test('????JS ?먮윭 ?놁쓬 (BottomNav쨌ProductTopBar 10px ?덉쇅 ?ы븿)', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })
})
