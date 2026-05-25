import { test, expect } from '@playwright/test'
import { AUTH_STATE_PATH } from './_helpers/auth'

// 어드민 화면은 셀러앱 내 /admin/* 경로 → SELLER_BASE 재사용
const BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr'

const adminEmail = process.env['TEST_ADMIN_EMAIL']
const adminPassword = process.env['TEST_ADMIN_PASSWORD']
const skipAuth = !adminEmail || !adminPassword

// ── 비인증 가드 ──────────────────────────────────────────────────────
test.describe('Admin — 판매자 목록 (비인증)', () => {
  test('/admin/stores — 비로그인 시 로그인으로 리디렉트', async ({ page }) => {
    await page.goto(`${BASE}/admin/stores`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ── 인증 후 읽기 전용 스모크 (#CL-53 치우기/아카이브 UI) ──────────────
// 운영 단일 DB 보호 위해 상태변경(치우기/복구) 클릭은 하지 않는다 — 노출·렌더만 확인.
test.describe('Admin — 판매자 치우기 UI (인증)', () => {
  // #CL-23: globalSetup이 발급한 세션 쿠키 재사용 — spec별 로그인 호출 제거
  test.use({ storageState: AUTH_STATE_PATH })
  test.skip(skipAuth, 'TEST_ADMIN_EMAIL/PASSWORD 미설정 — 어드민 인증 spec 건너뜀')

  test('/admin/stores 진입 + JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/admin/stores`)
    await page.waitForLoadState('networkidle')

    // admin role이면 로그인으로 튕기지 않아야 한다
    await expect(page).toHaveURL(/\/admin\/stores/)
    // "판매자 목록" 제목 렌더 확인
    await expect(page.getByText('판매자 목록')).toBeVisible({ timeout: 10_000 })

    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad'),
    )
    expect(critical).toHaveLength(0)
  })

  test('"정리된 판매자 보기" 토글 노출', async ({ page }) => {
    await page.goto(`${BASE}/admin/stores`)
    await page.waitForLoadState('networkidle')

    // 이번 기능에서 추가된 Switch — 라벨로 노출 확인(클릭은 안 함)
    await expect(page.getByText('정리된 판매자 보기')).toBeVisible({ timeout: 10_000 })
  })

  test('판매자 행이 1개 이상이면 수수료 설정 버튼 노출', async ({ page }) => {
    await page.goto(`${BASE}/admin/stores`)
    await page.waitForLoadState('networkidle')

    // 시드 판매자(테스트 꽃 농장)가 보이거나 빈 목록 문구가 보여야 한다.
    // 운영 데이터 상태에 의존하지 않도록 둘 중 하나만 만족하면 통과.
    const hasStore = await page
      .getByRole('button', { name: '수수료 설정' })
      .first()
      .isVisible()
      .catch(() => false)
    const isEmpty = await page
      .getByText('등록된 판매자가 없습니다.')
      .isVisible()
      .catch(() => false)
    expect(hasStore || isEmpty).toBe(true)
  })
})
