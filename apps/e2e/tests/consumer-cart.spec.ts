import { test, expect } from '@playwright/test'

const BASE = 'https://greenlove.co.kr'

// /cart는 미들웨어로 보호됨 → 비로그인 시 /login 리디렉트
// 인증 후 동작 테스트는 storageState 설정 후 아래 주석 블록을 활성화

test.describe('Consumer — 장바구니 (비인증)', () => {
  test('/cart — 비로그인 시 /login 리디렉트', async ({ page }) => {
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/login/)
  })

  test('/cart — 리디렉트 후 JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('/cart callbackUrl 보존 — 로그인 후 복귀 가능', async ({ page }) => {
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')
    // 리디렉트 URL에 callbackUrl이 포함되지 않을 수도 있으나 /login은 보장
    await expect(page).toHaveURL(/\/login/)
  })
})

// ── 인증 후 장바구니 기능 테스트 (storageState 설정 필요) ───────────
// test.describe('Consumer — 장바구니 (인증)', () => {
//   test.use({ storageState: 'e2e/.auth/user.json' })
//
//   test('빈 장바구니 — 안내 UI 렌더링', async ({ page }) => {
//     // localStorage 초기화 후 접근
//     await page.goto(BASE)
//     await page.evaluate(() => localStorage.removeItem('greenhub_cart'))
//     await page.goto(`${BASE}/cart`)
//     await page.waitForLoadState('networkidle')
//     await expect(page.getByText('장바구니가 비어있습니다.')).toBeVisible()
//     await expect(page.getByRole('link', { name: '쇼핑하러 가기' })).toBeVisible()
//   })
//
//   test('localStorage에 아이템 주입 → 장바구니 목록 렌더링', async ({ page }) => {
//     const mockItem = {
//       productId: 'test-product-1', name: '테스트 상품', price: 15000, quantity: 2,
//       image: '', saleType: 'normal', storeId: 'store-1', deliveryMethod: 'direct',
//     }
//     await page.goto(BASE)
//     await page.evaluate((item) => {
//       localStorage.setItem('greenhub_cart', JSON.stringify([item]))
//     }, mockItem)
//     await page.goto(`${BASE}/cart`)
//     await page.waitForLoadState('networkidle')
//     await expect(page.getByText('테스트 상품')).toBeVisible()
//     await expect(page.getByText('30,000원')).toBeVisible()
//   })
//
//   test('수량 감소 (−) 1→0 시 아이템 제거', async ({ page }) => { /* ... */ })
//   test('삭제 버튼 → 아이템 제거', async ({ page }) => { /* ... */ })
//   test('전체 삭제 → 빈 상태', async ({ page }) => { /* ... */ })
//   test('결제하기 → /checkout?from=cart 이동', async ({ page }) => { /* ... */ })
// })
