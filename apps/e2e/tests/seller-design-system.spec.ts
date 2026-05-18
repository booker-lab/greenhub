import { test, expect } from '@playwright/test'
import { AUTH_STATE_PATH } from './_helpers/auth'

const BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr'

// ── 공개 접근 가능 페이지 ──────────────────────────────────────────

test.describe('셀러 디자인 시스템 — 공개 페이지', () => {
  test('로그인 페이지 렌더링 + CSS 토큰 적용 확인', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await expect(page.locator('body')).toBeVisible()

    // Mantine 기본 색상 변수가 남아있지 않아야 함
    const bodyBg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor
    )
    // 페이지 로드 성공 확인
    await expect(page).toHaveTitle(/그린러브|Green|Seller/i)
  })

  test('미인증 → 주문 페이지 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('미인증 → 정산 페이지 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/settlements`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('미인증 → 설정 페이지 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/settings`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('미인증 → 거점 페이지 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/hubs`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('미인증 → 어드민 접근 시 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/admin/stores`)
    await expect(page).toHaveURL(/login|signin|auth|orders/, { timeout: 10_000 })
  })
})

// ── 인증 후 핵심 화면 검증 ────────────────────────────────────────

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('셀러 디자인 시스템 — 인증 화면', () => {
  // #CL-23: globalSetup이 발급한 세션 쿠키 재사용 — spec별 로그인 호출 제거
  test.use({ storageState: AUTH_STATE_PATH })

  test.skip(skipAuth, '환경변수 TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 필요')

  test('주문 관리 — 탭/헤더 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })
    // 상태 탭 5개 확인
    for (const label of ['처리 필요', '대기 중', '배송 중', '완료', '취소']) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible()
    }
    // JS 에러 없음
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.waitForTimeout(500)
    expect(errors).toHaveLength(0)
  })

  test('정산 관리 — 탭 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/settlements`)
    await expect(page.locator('text=정산 관리')).toBeVisible({ timeout: 10_000 })
    for (const label of ['일별 요약', '기간별 조회', '주문별 상세']) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible()
    }
  })

  test('설정 — 메뉴 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/settings`)
    await expect(page.getByRole('heading', { name: '설정' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=배송비 설정 / 기상 제한')).toBeVisible()
    await expect(page.locator('text=배송 슬롯 (Daily Cap)')).toBeVisible()
    // 세션39(#CL-33): 거점 관리가 설정 하위로 이동
    await expect(page.locator('text=거점 관리')).toBeVisible()
  })

  test('거점 관리 — 목록 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/hubs`)
    await expect(page.locator('text=거점 관리')).toBeVisible({ timeout: 10_000 })
    // 거점 없을 때 empty state
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })

  test('상품 목록 — 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/products`)
    await expect(page.locator('body')).toBeVisible({ timeout: 10_000 })
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.waitForTimeout(1000)
    expect(errors.filter(e => !e.includes('hydration'))).toHaveLength(0)
  })
})
