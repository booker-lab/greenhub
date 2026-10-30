import { test, expect } from '@playwright/test'

const BASE = process.env['DRIVER_BASE'] ?? 'https://driver.greenlove.co.kr'
const BASE_HOST = new URL(BASE).hostname
// 로컬 대상(화면 확인 하네스 `scripts/visual/start.mjs driver` 등 로컬 파일럿 로그인이 열린 next dev)
const IS_LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'].includes(BASE_HOST)

// ── 공개 접근 가능 페이지 ──────────────────────────────────────────

test.describe('드라이버 디자인 시스템 — 로그인 페이지', () => {
  test('로그인 페이지 정상 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await expect(page.locator('body')).toBeVisible()
    await expect(page.locator('text=Green Love')).toBeVisible()
    await expect(page.locator('text=기사 계정으로 로그인하세요')).toBeVisible()
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
    const kakaoBtn = page.getByRole('button', { name: '카카오로 시작하기' })
    await expect(kakaoBtn).toBeVisible()
    // 인라인 style이 아니라 계산된 스타일로 본다(Tailwind 클래스로 옮겨도 같은 판정).
    const bg = await kakaoBtn.evaluate((el) => getComputedStyle(el).backgroundColor)
    // 카카오 브랜드 컬러 #FEE500 보존 확인
    expect(bg).toBe('rgb(254, 229, 0)')
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
    // Paper 컨테이너(로고 제목을 감싼, 모서리가 둥근 첫 상자): boxShadow 없고 border 있어야 함.
    // 인라인 style이 아니라 계산된 스타일로 본다(Tailwind 클래스로 옮겨도 같은 판정).
    const paper = await page.getByRole('heading', { name: 'Green Love' }).evaluate((heading) => {
      for (let el = heading.parentElement; el; el = el.parentElement) {
        const s = getComputedStyle(el)
        if (s.borderTopLeftRadius !== '0px') {
          return {
            hasBorder: s.borderTopStyle !== 'none' && parseFloat(s.borderTopWidth) > 0,
            hasBoxShadow: s.boxShadow !== 'none',
          }
        }
      }
      return null
    })
    expect(paper).not.toBeNull()
    expect(paper?.hasBorder).toBe(true)
    expect(paper?.hasBoxShadow).toBe(false)
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
// 드라이버 앱은 카카오 OAuth 전용이다. 원격 대상은 DRIVER_SESSION_COOKIE(세션 쿠키 JSON)를 대상 주소의
// 도메인에 넣어 연다. 로컬 대상(루프백 DRIVER_BASE)은 로컬 파일럿 로그인(아무 이메일·비밀번호)으로 연다.
// 둘 다 아니면 건너뛴다. 로컬 대상에서 로그인이 안 되면 건너뛰지 않고 실패한다.
// 로컬: node scripts/visual/start.mjs driver → DRIVER_BASE=http://127.0.0.1:3203 pnpm exec playwright test driver-design-system

const sessionCookie = process.env['DRIVER_SESSION_COOKIE']

test.describe('드라이버 디자인 시스템 — 인증 화면 (세션 주입)', () => {
  test.skip(
    !sessionCookie && !IS_LOOPBACK,
    '환경변수 DRIVER_SESSION_COOKIE 또는 로컬 대상(루프백 DRIVER_BASE) 필요',
  )

  test.beforeEach(async ({ context }) => {
    if (sessionCookie) {
      // next-auth 세션 쿠키를 대상 주소의 도메인에 넣는다.
      const cookies = JSON.parse(sessionCookie) as Array<{
        name: string; value: string; domain?: string; path?: string
      }>
      await context.addCookies(cookies.map((c) => ({ ...c, domain: BASE_HOST, path: '/' })))
      return
    }
    // 로컬 파일럿 Credentials 로그인. 세션 쿠키는 컨텍스트에 남는다.
    const csrf = (await (await context.request.get(`${BASE}/api/auth/csrf`)).json()) as {
      csrfToken: string
    }
    await context.request.post(`${BASE}/api/auth/callback/credentials`, {
      maxRedirects: 0,
      form: {
        email: 'design-system@local.test',
        password: 'local',
        csrfToken: csrf.csrfToken,
        callbackUrl: BASE,
        json: 'true',
      },
    })
    const session = (await (await context.request.get(`${BASE}/api/auth/session`)).json()) as {
      user?: { role?: string; accessToken?: string }
    } | null
    expect(session?.user?.role, '로컬 대상 기사 로그인').toBe('driver')
    expect(session?.user?.accessToken).toBeTruthy()
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
    // 인라인 style이 아니라 계산된 스타일로 본다(Tailwind 클래스로 옮겨도 같은 판정).
    const result = await page.evaluate(() => {
      const nav = document.querySelector('nav')
      if (!nav) return { hasNav: false, hasBorderTop: false, hasBoxShadow: false }
      const s = getComputedStyle(nav)
      return {
        hasNav: true,
        hasBorderTop: s.borderTopStyle !== 'none' && parseFloat(s.borderTopWidth) > 0,
        hasBoxShadow: s.boxShadow !== 'none',
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
    // 하단 탭에도 '내 정보'가 있어 제목으로 찾는다.
    await expect(page.getByRole('heading', { name: '내 정보' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=연결된 계정')).toBeVisible()
    await expect(page.locator('text=앱 버전')).toBeVisible()
    await expect(page.locator('text=로그아웃')).toBeVisible()
  })
})
