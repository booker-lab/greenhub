import { test, expect } from '@playwright/test'

const BASE = 'https://driver.greenlove.co.kr'

// ── 공개 접근 가능 페이지 ──────────────────────────────────────────

test.describe('드라이버 디자인 시스템 — 로그인 페이지', () => {
  test('로그인 페이지 정상 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await expect(page.locator('body')).toBeVisible()
    await expect(page.locator('text=Green Love 드라이버')).toBeVisible()
    await expect(page.locator('text=드라이버 계정으로 로그인하세요')).toBeVisible()
    await expect(page.locator('text=카카오로 시작하기')).toBeVisible()
  })

  test('로그인 페이지 — JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')
    expect(errors.filter((e) => !e.includes('hydration'))).toHaveLength(0)
  })

  test('로그인 페이지 — 카카오 예외 색상(#FEE500) 유지', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    const kakaoBtn = page.locator('button[type="submit"]').first()
    await expect(kakaoBtn).toBeVisible()
    const bg = await kakaoBtn.evaluate((el) =>
      (el as HTMLElement).style.backgroundColor
    )
    // 카카오 브랜드 컬러 #FEE500 보존 확인
    expect(bg.toLowerCase()).toMatch(/fee500|rgb\(254,\s*229,\s*0\)/)
  })

  test('로그인 페이지 — 구 green-* CSS 변수 미사용', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    // --mantine-color-* 는 Mantine 컴포넌트 내부 주입 변수이므로 허용
    // 우리 코드에서 직접 사용한 구버전 --green-* 변수만 위반으로 판정
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

  test('로그인 페이지 — Paper border 적용 (shadow 제거)', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    // Paper 컨테이너: boxShadow 없고 border 있어야 함
    const paperEl = await page.evaluate(() => {
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

// ── 리디렉션 검증 ─────────────────────────────────────────────────

test.describe('드라이버 디자인 시스템 — 라우팅', () => {
  test('미인증 → /board 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/board`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('미인증 → /map 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/map`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('미인증 → /profile 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/profile`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ── 인증 후 핵심 화면 검증 ────────────────────────────────────────
// 드라이버 앱은 카카오 OAuth 전용 — 자동 로그인 테스트는 세션 쿠키 주입 방식 필요
// DRIVER_SESSION_COOKIE 환경변수 세팅 시 활성화

const sessionCookie = process.env['DRIVER_SESSION_COOKIE']

test.describe('드라이버 디자인 시스템 — 인증 화면 (세션 주입)', () => {
  test.skip(!sessionCookie, '환경변수 DRIVER_SESSION_COOKIE 필요')

  test.beforeEach(async ({ page, context }) => {
    // next-auth 세션 쿠키 주입
    const cookies = JSON.parse(sessionCookie!) as Array<{
      name: string; value: string; domain?: string; path?: string
    }>
    await context.addCookies(
      cookies.map((c) => ({ ...c, domain: 'driver.greenlove.co.kr', path: '/' }))
    )
  })

  test('배송 보드 — 헤더 + 탭 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/board`)
    await expect(page.locator('text=오늘 배송')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=수거 대기')).toBeVisible()
    await expect(page.locator('text=배송 중')).toBeVisible()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.waitForTimeout(500)
    expect(errors.filter((e) => !e.includes('hydration'))).toHaveLength(0)
  })

  test('배송 보드 — 구 Mantine 변수 미사용', async ({ page }) => {
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

  test('배송 보드 — BottomNav borderTop 적용 (boxShadow 제거)', async ({ page }) => {
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

  test('지도 페이지 — 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/map`)
    await expect(page.locator('text=오늘 배송 경로')).toBeVisible({ timeout: 10_000 })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.waitForTimeout(500)
    expect(errors.filter((e) => !e.includes('hydration'))).toHaveLength(0)
  })

  test('내 정보 — 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/profile`)
    await expect(page.locator('text=내 정보')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=연결된 계정')).toBeVisible()
    await expect(page.locator('text=앱 버전')).toBeVisible()
    await expect(page.locator('text=로그아웃')).toBeVisible()
  })
})
