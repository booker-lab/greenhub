import { test, expect } from '@playwright/test'

const BASE = 'https://greenlove.co.kr'

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
    // /mypage 리디렉트 후 로그인 페이지에서 BottomNav 확인
    await page.goto(`${BASE}/mypage`)
    await page.waitForLoadState('networkidle')
    // BottomNav label은 'MY' (대문자)
    await expect(page.getByText('MY')).toBeVisible()
  })
})

// ── 인증 후 마이페이지 테스트 (storageState 설정 필요) ───────────────
// test.describe('Consumer — 마이페이지 (인증)', () => {
//   test.use({ storageState: 'e2e/.auth/user.json' })
//
//   test('프로필 — 사용자 이름·이메일 표시', async ({ page }) => {
//     await page.goto(`${BASE}/mypage`)
//     await page.waitForLoadState('networkidle')
//     await expect(page.getByText(/@/)).toBeVisible()
//   })
//
//   test('주문 목록 렌더링 또는 빈 상태 안내', async ({ page }) => {
//     await page.goto(`${BASE}/mypage`)
//     await page.waitForLoadState('networkidle')
//     const empty = page.getByText('주문 내역이 없습니다')
//     const orderCard = page.locator('button').first()
//     const hasOrders = (await orderCard.count()) > 0
//     if (!hasOrders) await expect(empty).toBeVisible()
//   })
//
//   test('/mypage/addresses — 배송지 추가 폼 노출', async ({ page }) => {
//     await page.goto(`${BASE}/mypage/addresses`)
//     await page.waitForLoadState('networkidle')
//     await expect(page.locator('body')).toBeVisible()
//   })
//
//   test('/mypage/notifications — 알림 목록 또는 빈 상태', async ({ page }) => {
//     await page.goto(`${BASE}/mypage/notifications`)
//     await page.waitForLoadState('networkidle')
//     await expect(page.locator('body')).toBeVisible()
//   })
// })
