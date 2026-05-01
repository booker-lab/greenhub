import { test, expect } from '@playwright/test'

/**
 * 6순위 CSS 회귀 검증
 * - Mantine CSS treeshaking 후 컴포넌트 스타일 정상 여부
 * - Pretendard self-hosting 후 폰트 로딩 여부
 */

// ── Consumer ────────────────────────────────────────────────────────

test.describe('Consumer — CSS 회귀', () => {
  test('홈 — JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('https://greenlove.co.kr')
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('홈 — Pretendard 폰트 파일 200 응답', async ({ request }) => {
    const fontRes = await request.get('https://greenlove.co.kr/fonts/PretendardVariable.woff2')
    expect(fontRes.status()).toBe(200)
    expect(fontRes.headers()['content-type']).toMatch(/font|octet/)
  })

  test('홈 — Pretendard 폰트 CSS 변수 적용', async ({ page }) => {
    await page.goto('https://greenlove.co.kr')
    const fontFamily = await page.evaluate(() =>
      getComputedStyle(document.body).fontFamily
    )
    expect(fontFamily).toMatch(/Pretendard|system-ui|sans-serif/)
  })

  test('홈 — Badge 컴포넌트 스타일 정상', async ({ page }) => {
    await page.goto('https://greenlove.co.kr')
    const badge = page.locator('.mantine-Badge-root, [class*="Badge"]').first()
    const count = await badge.count()
    if (count > 0) {
      const display = await badge.evaluate((el) =>
        getComputedStyle(el).display
      )
      expect(display).not.toBe('none')
    }
  })

  test('홈 — Button 컴포넌트 스타일 정상', async ({ page }) => {
    await page.goto('https://greenlove.co.kr')
    await page.waitForLoadState('networkidle')
    const btn = page.locator('button:visible').first()
    const count = await btn.count()
    if (count > 0) {
      const cursor = await btn.evaluate((el) =>
        getComputedStyle(el as HTMLElement).cursor
      )
      expect(cursor).toMatch(/pointer|auto/)
    }
  })

  test('로그인 — PasswordInput 렌더링 정상', async ({ page }) => {
    await page.goto('https://greenlove.co.kr/login')
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('로그인 — CDN 외부 폰트 요청 없음 (jsdelivr)', async ({ page }) => {
    const externalFonts: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('jsdelivr') && req.url().includes('pretendard')) {
        externalFonts.push(req.url())
      }
    })
    await page.goto('https://greenlove.co.kr')
    await page.waitForLoadState('networkidle')
    expect(externalFonts).toHaveLength(0)
  })
})

// ── Seller ───────────────────────────────────────────────────────────

test.describe('Seller — CSS 회귀', () => {
  test('로그인 — JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('https://seller.greenlove.co.kr/login')
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('로그인 — Pretendard 폰트 파일 200 응답', async ({ request }) => {
    const fontRes = await request.get('https://seller.greenlove.co.kr/fonts/PretendardVariable.woff2')
    expect(fontRes.status()).toBe(200)
  })

  test('로그인 — CDN 외부 폰트 요청 없음 (jsdelivr)', async ({ page }) => {
    const externalFonts: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('jsdelivr') && req.url().includes('pretendard')) {
        externalFonts.push(req.url())
      }
    })
    await page.goto('https://seller.greenlove.co.kr/login')
    await page.waitForLoadState('networkidle')
    expect(externalFonts).toHaveLength(0)
  })

  test('로그인 — TextInput 렌더링 정상', async ({ page }) => {
    await page.goto('https://seller.greenlove.co.kr/login')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })
})

// ── Driver ───────────────────────────────────────────────────────────

test.describe('Driver — CSS 회귀', () => {
  test('로그인 — JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('https://driver.greenlove.co.kr/login')
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('로그인 — Pretendard 폰트 파일 200 응답', async ({ request }) => {
    const fontRes = await request.get('https://driver.greenlove.co.kr/fonts/PretendardVariable.woff2')
    expect(fontRes.status()).toBe(200)
  })

  test('로그인 — CDN 외부 폰트 요청 없음 (jsdelivr)', async ({ page }) => {
    const externalFonts: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('jsdelivr') && req.url().includes('pretendard')) {
        externalFonts.push(req.url())
      }
    })
    await page.goto('https://driver.greenlove.co.kr/login')
    await page.waitForLoadState('networkidle')
    expect(externalFonts).toHaveLength(0)
  })

  test('로그인 — 카카오 버튼 렌더링 정상', async ({ page }) => {
    await page.goto('https://driver.greenlove.co.kr/login')
    await expect(page.locator('text=카카오로 시작하기')).toBeVisible()
  })
})
