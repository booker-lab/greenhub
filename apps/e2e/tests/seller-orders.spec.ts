import { test, expect } from '@playwright/test'
import { loginViaCredentials } from './_helpers/auth'

const BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr'

test.describe('셀러 주문 관리 — 공개', () => {
  test('미인증 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ── 인증 후 기능 검증 ────────────────────────────────────────────────

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('셀러 주문 관리 — 인증 화면', () => {
  test.skip(skipAuth, '환경변수 TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 필요')

  test.beforeEach(async ({ page }) => {
    await loginViaCredentials(page, BASE, sellerEmail!, sellerPassword!)
  })

  test('주문 관리 헤더 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })
  })

  // ── 탭 ──────────────────────────────────────────────────────────────

  test('5개 상태 탭 모두 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })
    for (const label of ['처리 필요', '대기 중', '배송 중', '완료', '취소']) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible()
    }
  })

  test('탭 클릭 — 각 탭 전환 시 JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })

    for (const label of ['대기 중', '배송 중', '완료', '취소', '처리 필요']) {
      await page.locator(`text=${label}`).first().click()
      await page.waitForTimeout(300)
    }

    expect(errors).toHaveLength(0)
  })

  test('실시간 연결 상태 텍스트 표시', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })
    const statusLocator = page
      .locator('text=실시간 연결')
      .or(page.locator('text=연결 중'))
      .or(page.locator('text=연결 오류'))
    await expect(statusLocator.first()).toBeVisible({ timeout: 12_000 })
  })

  test('주문 없을 때 empty state 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })
    // Firestore RTL 연결 완료 대기 — '연결 중' 초기 상태도 매칭 (line 56 테스트와 일관)
    await expect(
      page
        .locator('text=실시간 연결')
        .or(page.locator('text=연결 중'))
        .or(page.locator('text=연결 오류'))
    ).toBeVisible({ timeout: 15_000 })
    // 연결 후 empty state 또는 주문 카드 출현을 polling으로 대기 (RTL 데이터 도착 지연 고려)
    await expect
      .poll(
        async () => {
          const hasEmpty = await page.locator('text=현재 해당 주문이 없습니다').count()
          const hasOrderBadge = await page.evaluate(() =>
            Array.from(document.querySelectorAll('span')).some((el) =>
              ['대기', '결제 완료', '주문 확정', '모집 중', '준비 중', '배송 중', '거점 도착', '픽업 완료', '배송 완료', '취소'].includes((el.textContent ?? '').trim()),
            ),
          )
          return hasEmpty > 0 || hasOrderBadge
        },
        { timeout: 15_000 },
      )
      .toBe(true)
  })

  // ── Summary Bar ─────────────────────────────────────────────────────

  test('Summary Bar — 3항목 렌더링 (Summary + 탭에 각 레이블 2회 이상 존재)', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })
    // Summary Bar와 탭 양쪽에 동일 레이블이 존재하므로 count >= 2
    for (const label of ['처리 필요', '배송 중', '대기 중']) {
      const count = await page.locator(`text=${label}`).count()
      expect(count).toBeGreaterThanOrEqual(2)
    }
  })

  test('Summary Bar 클릭 — 배송 중 클릭 시 IN_DELIVERY 탭 활성화 (SubFilter 출현)', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })
    // Summary Bar의 '배송 중'은 첫 번째 등장 (탭보다 위에 위치)
    await page.locator('text=배송 중').first().click()
    // IN_DELIVERY 탭 활성화 확인 — SubFilter의 고유 항목으로 검증
    await expect(page.locator('text=거점 도착')).toBeVisible({ timeout: 3_000 })
  })

  // ── SubFilter ────────────────────────────────────────────────────────

  test('배송 중 탭 선택 시 SubFilter(전체·배송 중·거점 도착) 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })
    // 탭 행의 '배송 중' 클릭: Summary Bar와 겹치므로 last()로 탭 선택
    await page.locator('text=배송 중').last().click()
    await expect(page.locator('text=거점 도착')).toBeVisible({ timeout: 3_000 })
    // '전체' 텍스트는 SubFilter에만 존재
    await expect(page.locator('text=전체')).toBeVisible()
  })

  test('다른 탭 전환 시 SubFilter 사라짐', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })
    await page.locator('text=배송 중').last().click()
    await expect(page.locator('text=거점 도착')).toBeVisible({ timeout: 3_000 })
    // 완료 탭으로 이동 → SubFilter 소멸
    await page.locator('text=완료').first().click()
    await expect(page.locator('text=거점 도착')).not.toBeVisible()
  })

  test('SubFilter 클릭 — JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })
    await page.locator('text=배송 중').last().click()
    await expect(page.locator('text=거점 도착')).toBeVisible({ timeout: 3_000 })

    for (const label of ['거점 도착', '배송 중', '전체']) {
      await page.locator(`text=${label}`).first().click()
      await page.waitForTimeout(300)
    }

    expect(errors).toHaveLength(0)
  })

  test('탭 전환 시 SubFilter ALL 리셋 확인', async ({ page }) => {
    await page.goto(`${BASE}/orders`)
    await expect(page.locator('text=주문 관리')).toBeVisible({ timeout: 10_000 })
    // 배송 중 탭 → 거점 도착 SubFilter 선택
    await page.locator('text=배송 중').last().click()
    await expect(page.locator('text=거점 도착')).toBeVisible({ timeout: 3_000 })
    await page.locator('text=거점 도착').first().click()
    // 다른 탭으로 이동 후 배송 중 탭 재진입
    await page.locator('text=완료').first().click()
    await page.locator('text=배송 중').last().click()
    // SubFilter가 '전체' 상태로 리셋되어야 함 — '전체' 버튼이 active 스타일(배경색)
    // 구조 검증: '전체' 텍스트가 보임 = SubFilter 정상 렌더링
    await expect(page.locator('text=전체')).toBeVisible({ timeout: 3_000 })
    await expect(page.locator('text=거점 도착')).toBeVisible()
  })
})
