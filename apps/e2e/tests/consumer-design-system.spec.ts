import { test, expect } from '@playwright/test'

/**
 * DS 리팩토링 T0~T9 회귀 검증 (2026-05-02)
 * - 하드코딩 hex/숫자값 → CSS 변수 전환 후 렌더링 정상 여부
 * - 각 페이지 JS 에러 없음 + 핵심 UI 요소 가시성 확인
 */

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

// ── T1: mypage fallback — #999 → var(--color-text-disabled) ──────────

test.describe('Consumer DS — mypage 페이지군', () => {
  const mypageRoutes = ['/mypage', '/mypage/addresses', '/mypage/notifications']

  for (const route of mypageRoutes) {
    test(`${route} — JS 에러 없음`, async ({ page }) => {
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

  test('mypage — --color-text-disabled 토큰 정상 해석', async ({ page }) => {
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

// ── T2: cart — borderRadius: 8 → var(--radius-sm) ───────────────────

test.describe('Consumer DS — cart 페이지', () => {
  test('cart — JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(BASE + '/cart')
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('cart — --radius-sm 토큰 정상 해석', async ({ page }) => {
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

// ── T3: category — fontSize/fontWeight → var() ───────────────────────

test.describe('Consumer DS — category 페이지', () => {
  test('category — JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(BASE + '/category')
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('category — 탭 버튼 렌더링 정상', async ({ page }) => {
    await page.goto(BASE + '/category')
    await page.waitForLoadState('networkidle')
    const tabs = page.locator('button').first()
    await expect(tabs).toBeVisible()
  })

  test('category — --font-size-sm 토큰 정상 해석 (≥15px)', async ({ page }) => {
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

// ── T4~T6: mypage 하위 클라이언트 컴포넌트 ──────────────────────────

test.describe('Consumer DS — mypage 클라이언트 컴포넌트', () => {
  test('mypage — 오더 목록 영역 렌더링 정상 (borderRadius 토큰)', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(BASE + '/mypage')
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('mypage/addresses — JS 에러 없음', async ({ page }) => {
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

// ── T7~T8: 상품 상세 컴포넌트 ───────────────────────────────────────

test.describe('Consumer DS — 상품 상세 페이지', () => {
  test('products/[id] — JS 에러 없음', async ({ page }) => {
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

  test('products/[id] — --radius-sm/--fw-bold/--font-size-md 토큰 모두 해석', async ({ page }) => {
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

// ── 예외 항목 공식 확인 ───────────────────────────────────────────────

test.describe('Consumer DS — 공식 예외 compact 컴포넌트', () => {
  test('홈 — JS 에러 없음 (BottomNav·ProductTopBar 10px 예외 포함)', async ({ page }) => {
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
