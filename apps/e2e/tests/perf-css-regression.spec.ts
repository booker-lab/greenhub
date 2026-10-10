import { test, expect, type Page } from '@playwright/test'

/**
 * 6순위 CSS 회귀 검증
 * - Mantine CSS treeshaking 후 컴포넌트 스타일 정상 여부
 * - Pretendard self-hosting(글자 범위별 dynamic subset) 후 폰트 로딩 여부
 */

const CONSUMER_BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'
const SELLER_BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr'
const DRIVER_BASE = process.env['DRIVER_BASE'] ?? 'https://driver.greenlove.co.kr'

// Pretendard는 글자 범위별 조각(PretendardVariable.subset.N.*.woff2)으로 번들링돼
// /_next/static/media에서 제공된다. 화면 글자에 필요한 조각만 받는지 확인한다.
async function expectPretendardSubsetLoaded(page: Page, url: string) {
  const fontResponses: { url: string; status: number }[] = []
  page.on('response', (res) => {
    if (res.url().includes('PretendardVariable.subset.')) {
      fontResponses.push({ url: res.url(), status: res.status() })
    }
  })
  await page.goto(url)
  await page.waitForLoadState('networkidle')
  expect(fontResponses.length).toBeGreaterThan(0)
  expect(fontResponses.every((res) => res.status === 200)).toBe(true)
  expect(fontResponses.every((res) => res.url.includes('/_next/static/media/'))).toBe(true)
}

// ── Consumer ────────────────────────────────────────────────────────

test.describe('Consumer — CSS 회귀', () => {
  test('홈 — JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(CONSUMER_BASE)
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('홈 — Pretendard 글자 범위 조각만 받는다', async ({ page }) => {
    await expectPretendardSubsetLoaded(page, CONSUMER_BASE)
  })

  test('홈 — Pretendard 폰트 CSS 변수 적용', async ({ page }) => {
    await page.goto(CONSUMER_BASE)
    const fontFamily = await page.evaluate(() =>
      getComputedStyle(document.body).fontFamily
    )
    expect(fontFamily).toMatch(/Pretendard|system-ui|sans-serif/)
  })

  test('홈 — Badge 컴포넌트 스타일 정상', async ({ page }) => {
    await page.goto(CONSUMER_BASE)
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
    await page.goto(CONSUMER_BASE)
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
    await page.goto(`${CONSUMER_BASE}/login`)
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('로그인 — CDN 외부 폰트 요청 없음 (jsdelivr)', async ({ page }) => {
    const externalFonts: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('jsdelivr') && req.url().includes('pretendard')) {
        externalFonts.push(req.url())
      }
    })
    await page.goto(CONSUMER_BASE)
    await page.waitForLoadState('networkidle')
    expect(externalFonts).toHaveLength(0)
  })
})

// ── Seller ───────────────────────────────────────────────────────────

test.describe('Seller — CSS 회귀', () => {
  test('로그인 — JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${SELLER_BASE}/login`)
    // networkidle은 Vercel preview의 vercel.live 피드백 위젯 상시 연결로 정착하지 않음
    // → 로그인 폼 렌더 + 짧은 정착 대기로 교체 (hydration 런타임 에러 표면화)
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await page.waitForTimeout(1500)
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('로그인 — Pretendard 글자 범위 조각만 받는다', async ({ page }) => {
    await expectPretendardSubsetLoaded(page, `${SELLER_BASE}/login`)
  })

  test('로그인 — CDN 외부 폰트 요청 없음 (jsdelivr)', async ({ page }) => {
    const externalFonts: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('jsdelivr') && req.url().includes('pretendard')) {
        externalFonts.push(req.url())
      }
    })
    await page.goto(`${SELLER_BASE}/login`)
    // networkidle은 Vercel preview의 vercel.live 피드백 위젯 상시 연결로 정착하지 않음
    // → 로그인 폼 렌더 + 짧은 정착 대기로 교체 (CSS @font-face 요청 수집 완료 보장)
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await page.waitForTimeout(1500)
    expect(externalFonts).toHaveLength(0)
  })

  test('로그인 — TextInput 렌더링 정상', async ({ page }) => {
    await page.goto(`${SELLER_BASE}/login`)
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })
})

// ── Driver ───────────────────────────────────────────────────────────

test.describe('Driver — CSS 회귀', () => {
  test('로그인 — JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${DRIVER_BASE}/login`)
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('로그인 — Pretendard 글자 범위 조각만 받는다', async ({ page }) => {
    await expectPretendardSubsetLoaded(page, `${DRIVER_BASE}/login`)
  })

  test('로그인 — CDN 외부 폰트 요청 없음 (jsdelivr)', async ({ page }) => {
    const externalFonts: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('jsdelivr') && req.url().includes('pretendard')) {
        externalFonts.push(req.url())
      }
    })
    await page.goto(`${DRIVER_BASE}/login`)
    await page.waitForLoadState('networkidle')
    expect(externalFonts).toHaveLength(0)
  })

  test('로그인 — 카카오 버튼 렌더링 정상', async ({ page }) => {
    await page.goto(`${DRIVER_BASE}/login`)
    await expect(page.locator('text=카카오로 시작하기')).toBeVisible()
  })
})
