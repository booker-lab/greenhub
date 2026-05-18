import { test, expect } from '@playwright/test'
import { AUTH_STATE_PATH } from './_helpers/auth'

const BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr'

// 세션39(#CL-33): 홈을 "오늘 할 일 + 현황 카드 3개" 대시보드로 재구성.
// 기존 지표 카드 4개(신규/전체/취소/재고부족) 레이아웃은 폐기.

// ── 비인증 ────────────────────────────────────────────────────────────────────

test.describe('셀러 홈 대시보드 — 공개', () => {
  test('미인증 / 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ── 인증 후 ───────────────────────────────────────────────────────────────────

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('셀러 홈 대시보드 — 인증', () => {
  // #CL-23: globalSetup이 발급한 세션 쿠키 재사용 — spec별 로그인 호출 제거
  test.use({ storageState: AUTH_STATE_PATH })

  test.skip(skipAuth, '환경변수 TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 필요')

  /** 홈 진입 + 실시간 연결 인디케이터 노출까지 대기. */
  async function gotoHome(page: import('@playwright/test').Page) {
    await page.goto(`${BASE}/`)
    await expect(page.locator('text=홈').first()).toBeVisible({ timeout: 10_000 })
    await expect(
      page.locator('text=실시간 연결').or(page.locator('text=연결 오류')),
    ).toBeVisible({ timeout: 12_000 })
  }

  // ── 헤더 ─────────────────────────────────────────────────────────────────

  test('홈 헤더 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(page.locator('text=홈').first()).toBeVisible({ timeout: 10_000 })
  })

  test('실시간 연결 상태 표시', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await expect(page.locator('text=홈').first()).toBeVisible({ timeout: 10_000 })
    const statusLocator = page
      .locator('text=실시간 연결')
      .or(page.locator('text=연결 중'))
      .or(page.locator('text=연결 오류'))
    await expect(statusLocator.first()).toBeVisible({ timeout: 12_000 })
  })

  // ── 오늘 할 일 카드 ────────────────────────────────────────────────────────

  test('오늘 할 일 카드 렌더링', async ({ page }) => {
    await gotoHome(page)
    await expect(page.locator('text=오늘 할 일').first()).toBeVisible()
  })

  // ── 현황 카드 3개 ──────────────────────────────────────────────────────────

  test('현황 카드 3개 — 주문/정산/상품 렌더링', async ({ page }) => {
    await gotoHome(page)
    for (const title of ['주문 처리 현황', '정산 현황', '상품 현황']) {
      await expect(page.locator(`text=${title}`).first()).toBeVisible()
    }
  })

  test('주문 처리 현황 — 파이프라인 4단계 레이블', async ({ page }) => {
    await gotoHome(page)
    for (const label of ['처리 필요', '대기 중', '배송 중', '완료']) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible()
    }
  })

  test('정산 현황 — 오늘 정산 예정 표시', async ({ page }) => {
    await gotoHome(page)
    await expect(page.locator('text=오늘 정산 예정').first()).toBeVisible()
  })

  test('상품 현황 — 판매 중/비활성 표시', async ({ page }) => {
    await gotoHome(page)
    await expect(page.locator('text=판매 중').first()).toBeVisible()
    await expect(page.locator('text=비활성').first()).toBeVisible()
  })

  // ── 딥링크 ────────────────────────────────────────────────────────────────

  test('파이프라인 처리 필요 클릭 → /orders 이동', async ({ page }) => {
    await gotoHome(page)
    await page.locator('text=처리 필요').first().click()
    await expect(page).toHaveURL(/\/orders/, { timeout: 8_000 })
  })

  // ── JS 에러 없음 ──────────────────────────────────────────────────────────

  test('홈 진입 시 JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await gotoHome(page)
    await page.waitForTimeout(500)

    expect(errors).toHaveLength(0)
  })
})
