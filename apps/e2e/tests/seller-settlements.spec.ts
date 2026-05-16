import { test, expect } from '@playwright/test'
import { AUTH_STATE_PATH } from './_helpers/auth'

const BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr'

// ── 비인증 ────────────────────────────────────────────────────────────────────

test.describe('셀러 정산 관리 — 공개', () => {
  test('미인증 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/settlements`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ── 인증 후 ───────────────────────────────────────────────────────────────────

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('셀러 정산 관리 — 인증', () => {
  // #CL-23: globalSetup이 발급한 세션 쿠키 재사용 — spec별 로그인 호출 제거
  test.use({ storageState: AUTH_STATE_PATH })

  test.skip(skipAuth, '환경변수 TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 필요')

  // ── 페이지 구조 ───────────────────────────────────────────────────────────

  test('정산 관리 헤더 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/settlements`)
    await expect(page.locator('text=정산 관리')).toBeVisible({ timeout: 10_000 })
  })

  test('탭 3개 렌더링 (일별 요약·기간별 조회·주문별 상세)', async ({ page }) => {
    await page.goto(`${BASE}/settlements`)
    await expect(page.locator('text=정산 관리')).toBeVisible({ timeout: 10_000 })
    for (const label of ['일별 요약', '기간별 조회', '주문별 상세']) {
      await expect(page.locator(`text=${label}`)).toBeVisible()
    }
  })

  // ── G3: 일별 날짜 선택기 ──────────────────────────────────────────────────

  test('G3 — 일별 요약 탭에 날짜 선택기(date input) 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/settlements`)
    await expect(page.locator('text=정산 관리')).toBeVisible({ timeout: 10_000 })
    await page.locator('text=일별 요약').click()

    // date input 존재 확인
    await expect(page.locator('input[type="date"]').first()).toBeVisible({ timeout: 5_000 })
  })

  test('G3 — 날짜 선택기 max 값이 오늘 이하', async ({ page }) => {
    await page.goto(`${BASE}/settlements`)
    await expect(page.locator('text=정산 관리')).toBeVisible({ timeout: 10_000 })
    await page.locator('text=일별 요약').click()

    const today = new Date().toISOString().split('T')[0]
    const maxAttr = await page.locator('input[type="date"]').first().getAttribute('max')
    expect(maxAttr).toBe(today)
  })

  test('G3 — 날짜 변경 시 JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/settlements`)
    await expect(page.locator('text=정산 관리')).toBeVisible({ timeout: 10_000 })
    await page.locator('text=일별 요약').click()

    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
    await page.locator('input[type="date"]').first().fill(yesterday)
    await page.waitForTimeout(1_000)

    expect(errors).toHaveLength(0)
  })

  test('G3 — 날짜 변경 후 날짜 레이블 갱신', async ({ page }) => {
    await page.goto(`${BASE}/settlements`)
    await expect(page.locator('text=정산 관리')).toBeVisible({ timeout: 10_000 })
    await page.locator('text=일별 요약').click()

    // 어제 날짜로 변경
    const yesterday = new Date(Date.now() - 86400000)
    const yesterdayStr = yesterday.toISOString().split('T')[0]
    const yesterdayDay = yesterday.getDate().toString()

    await page.locator('input[type="date"]').first().fill(yesterdayStr)
    await page.waitForTimeout(300)

    // 날짜 레이블에 어제 일(day) 숫자가 포함되어야 함
    const labelLocator = page.locator(`text=${yesterdayDay}일`)
    await expect(labelLocator.first()).toBeVisible({ timeout: 3_000 })
  })

  // ── 탭 전환 ──────────────────────────────────────────────────────────────

  test('탭 전환 시 JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/settlements`)
    await expect(page.locator('text=정산 관리')).toBeVisible({ timeout: 10_000 })

    for (const label of ['기간별 조회', '주문별 상세', '일별 요약']) {
      await page.locator(`text=${label}`).click()
      await page.waitForTimeout(500)
    }

    expect(errors).toHaveLength(0)
  })
})
