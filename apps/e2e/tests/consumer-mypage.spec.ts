import { test, expect } from '@playwright/test'
import { AUTH_STATE_PATH } from './_helpers/auth'

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

const consumerEmail = process.env['TEST_CONSUMER_EMAIL']
const consumerPassword = process.env['TEST_CONSUMER_PASSWORD']
const skipAuth = !consumerEmail || !consumerPassword

// /mypage/* 는 미들웨어로 보호됨 → 비로그인 시 /login 리디렉트
test.describe('Consumer — 마이페이지 (비인증)', () => {
  test('/mypage — 비로그인 시 /login 리디렉트', async ({ page }) => {
    await page.goto(`${BASE}/mypage`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/login/)
  })

  test('/mypage — JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/mypage`)
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('/mypage/addresses — 비로그인 시 /login 리디렉트', async ({ page }) => {
    await page.goto(`${BASE}/mypage/addresses`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/login/)
  })

  test('/mypage/notifications — 비로그인 시 /login 리디렉트', async ({ page }) => {
    await page.goto(`${BASE}/mypage/notifications`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/login/)
  })

  test('/mypage/orders/[id] — 비로그인 시 /login 리디렉트', async ({ page }) => {
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

  test('로그인 페이지 — BottomNav MY 탭 노출', async ({ page }) => {
    await page.goto(`${BASE}/mypage`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('MY')).toBeVisible()
  })
})

// ── 인증 후 마이페이지 테스트 ─────────────────────────────────────────────

test.describe('Consumer — 마이페이지 (인증)', () => {
  // #CL-23: globalSetup이 발급한 세션 쿠키 재사용 — spec별 로그인 호출 제거
  test.use({ storageState: AUTH_STATE_PATH })

  test.skip(skipAuth, '환경변수 TEST_CONSUMER_EMAIL / TEST_CONSUMER_PASSWORD 필요')

  test('프로필 — 이메일 표시', async ({ page }) => {
    await page.goto(`${BASE}/mypage`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/@/)).toBeVisible({ timeout: 10_000 })
  })

  test('주문 목록 렌더링 또는 빈 상태 안내', async ({ page }) => {
    await page.goto(`${BASE}/mypage`)
    await page.waitForLoadState('networkidle')
    const empty = page.getByText('주문 내역이 없습니다')
    const hasOrders = (await page.locator('[data-testid="order-card"]').count()) > 0
    if (!hasOrders) await expect(empty).toBeVisible({ timeout: 10_000 })
  })

  test('/mypage/addresses — JS 에러 없이 렌더링', async ({ page }) => {
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

  test('/mypage/notifications — JS 에러 없이 렌더링', async ({ page }) => {
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
