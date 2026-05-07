import { test, expect } from '@playwright/test'

const BASE = 'https://greenlove.co.kr'

const consumerEmail = process.env['TEST_CONSUMER_EMAIL']
const consumerPassword = process.env['TEST_CONSUMER_PASSWORD']
const skipAuth = !consumerEmail || !consumerPassword

// /checkout, /order/* 는 미들웨어로 보호됨 → 비로그인 시 /login 리디렉트
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

// ── 인증 후 결제 UI 테스트 ────────────────────────────────────────────────

test.describe('Consumer — 결제 (인증)', () => {
  test.skip(skipAuth, '환경변수 TEST_CONSUMER_EMAIL / TEST_CONSUMER_PASSWORD 필요')

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')
    await page.getByLabel('이메일').fill(consumerEmail!)
    await page.getByLabel('비밀번호').fill(consumerPassword!)
    await page.getByRole('button', { name: '로그인' }).click()
    await page.waitForURL((url) => !url.pathname.includes('login'), { timeout: 15_000 })
  })

  test('/checkout — 결제 UI 핵심 요소 렌더링', async ({ page }) => {
    const mockCartItems = [
      {
        productId: 'checkout-test-1',
        name: '체크아웃 테스트 상품',
        price: 25000,
        quantity: 2,
        image: '',
        saleType: 'normal',
        storeId: 'store-1',
        deliveryMethod: 'direct',
      },
    ]
    await page.goto(BASE)
    await page.evaluate((items) => {
      sessionStorage.setItem('checkout_cart', JSON.stringify(items))
    }, mockCartItems)
    await page.goto(`${BASE}/checkout?from=cart`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('배송지')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('결제 수단')).toBeVisible()
    // exact: true — '카카오페이로 결제하기' 버튼과 중복 매칭 방지
    await expect(page.getByText('카카오페이', { exact: true })).toBeVisible()
  })

  test('/checkout — sessionStorage 카트 데이터 → 주문 요약 상품명 표시', async ({ page }) => {
    const mockCartItems = [
      {
        productId: 'checkout-test-2',
        name: '주문요약 테스트 상품',
        price: 12000,
        quantity: 1,
        image: '',
        saleType: 'normal',
        storeId: 'store-1',
        deliveryMethod: 'direct',
      },
    ]
    await page.goto(BASE)
    await page.evaluate((items) => {
      sessionStorage.setItem('checkout_cart', JSON.stringify(items))
    }, mockCartItems)
    await page.goto(`${BASE}/checkout?from=cart`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('주문요약 테스트 상품')).toBeVisible({ timeout: 10_000 })
  })

  test('/checkout — 빈 카트 상태 → 결제하기 버튼 비활성화 또는 안내 표시', async ({ page }) => {
    await page.goto(BASE)
    await page.evaluate(() => sessionStorage.removeItem('checkout_cart'))
    await page.goto(`${BASE}/checkout?from=cart`)
    await page.waitForLoadState('networkidle')
    const payBtn = page.getByRole('button', { name: /결제하기/ })
    const isEmpty = (await payBtn.count()) === 0 || (await payBtn.isDisabled())
    expect(isEmpty).toBeTruthy()
  })
})
