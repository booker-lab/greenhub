import { test, expect } from '@playwright/test'

const BASE = 'https://greenlove.co.kr'

// /checkout, /order/* 는 미들웨어로 보호됨 → 비로그인 시 /login 리디렉트
// 인증 후 결제 UI 테스트는 storageState 설정 후 아래 주석 블록을 활성화

test.describe('Consumer — 결제 (비인증)', () => {
  test('/checkout — 비로그인 시 /login 리디렉트', async ({ page }) => {
    await page.goto(`${BASE}/checkout?from=cart`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/login/)
  })

  test('/checkout — 리디렉트 후 JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/checkout?from=cart`)
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('/order/success — 비로그인 시 /login 리디렉트', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/order/success?orderId=test-order-000`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/login/)
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })
})

// ── 인증 후 결제 UI 테스트 (storageState 설정 필요) ──────────────────
// test.describe('Consumer — 결제 (인증)', () => {
//   test.use({ storageState: 'e2e/.auth/user.json' })
//
//   test('/checkout — 결제 UI 핵심 요소 렌더링', async ({ page }) => {
//     await page.goto(`${BASE}/checkout?from=cart`)
//     await page.waitForLoadState('networkidle')
//     await expect(page.getByText('결제')).toBeVisible()
//     await expect(page.getByText('배송지')).toBeVisible()
//     await expect(page.getByRole('button', { name: '주소 검색' })).toBeVisible()
//     await expect(page.getByText('결제 수단')).toBeVisible()
//     await expect(page.getByText('카카오페이')).toBeVisible()
//   })
//
//   test('/checkout — 장바구니 비어있을 때 결제 버튼 비활성화', async ({ page }) => {
//     await page.goto(`${BASE}/checkout?from=cart`)
//     await page.waitForLoadState('networkidle')
//     const payBtn = page.getByRole('button', { name: /결제하기/ })
//     await expect(payBtn).toBeDisabled()
//   })
//
//   test('/checkout — sessionStorage 카트 데이터 → 주문 요약 렌더', async ({ page }) => {
//     const mockCartItems = [{
//       productId: 'checkout-test-1', name: '체크아웃 테스트 상품', price: 25000, quantity: 2,
//       image: '', saleType: 'normal', storeId: 'store-1', deliveryMethod: 'direct',
//     }]
//     await page.goto(BASE)
//     await page.evaluate((items) => {
//       sessionStorage.setItem('checkout_cart', JSON.stringify(items))
//     }, mockCartItems)
//     await page.goto(`${BASE}/checkout?from=cart`)
//     await page.waitForLoadState('networkidle')
//     await expect(page.getByText('체크아웃 테스트 상품')).toBeVisible()
//   })
//
//   test('/order/success — 주문 완료 UI 렌더링', async ({ page }) => {
//     await page.goto(`${BASE}/order/success?orderId=test-order-999`)
//     await page.waitForLoadState('networkidle')
//     await expect(page.locator('body')).toBeVisible()
//   })
// })
