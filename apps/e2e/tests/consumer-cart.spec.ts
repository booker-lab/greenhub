import { test, expect } from '@playwright/test'
import { AUTH_STATE_PATH, loginViaCredentials } from './_helpers/auth'

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

const consumerEmail = process.env['TEST_CONSUMER_EMAIL']
const consumerPassword = process.env['TEST_CONSUMER_PASSWORD']
const skipAuth = !consumerEmail || !consumerPassword

// /cart는 미들웨어로 보호됨 → 비로그인 시 /login 리디렉트
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
    await expect(page).toHaveURL(/\/login/)
  })
})

// ── 인증 후 장바구니 기능 테스트 ────────────────────────────────────────

test.describe('Consumer — 장바구니 (인증)', () => {
  // #CL-23: globalSetup이 발급한 세션 쿠키 재사용 — spec별 로그인 호출 제거
  test.use({ storageState: AUTH_STATE_PATH })

  test.skip(skipAuth, '환경변수 TEST_CONSUMER_EMAIL / TEST_CONSUMER_PASSWORD 필요')

  test.beforeEach(async ({ page }) => {
    await loginViaCredentials(page, BASE, consumerEmail!, consumerPassword!)
  })

  test('빈 장바구니 — 안내 UI 렌더링', async ({ page }) => {
    await page.goto(BASE)
    await page.evaluate(() => localStorage.removeItem('greenhub_cart'))
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('장바구니가 비어있습니다.')).toBeVisible()
    await expect(page.getByRole('link', { name: '쇼핑하러 가기' })).toBeVisible()
  })

  test('localStorage 아이템 주입 → 상품명·금액 렌더링', async ({ page }) => {
    const mockItem = {
      productId: 'test-product-1',
      name: '테스트 상품',
      price: 15000,
      quantity: 2,
      image: '',
      saleType: 'normal',
      storeId: 'store-1',
      deliveryMethod: 'direct',
    }
    await page.goto(BASE)
    await page.evaluate((item) => {
      localStorage.setItem('greenhub_cart', JSON.stringify([item]))
    }, mockItem)
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('테스트 상품')).toBeVisible()
    // 30,000원은 아이템 행 + 합계 Footer 2곳에 렌더 → .first()로 strict mode 회피
    await expect(page.getByText('30,000원').first()).toBeVisible()
  })

  test('결제하기 버튼 → /checkout?from=cart 이동', async ({ page }) => {
    const mockItem = {
      productId: 'test-product-2',
      name: '결제 테스트 상품',
      price: 10000,
      quantity: 1,
      image: '',
      saleType: 'normal',
      storeId: 'store-1',
      deliveryMethod: 'direct',
    }
    await page.goto(BASE)
    await page.evaluate((item) => {
      localStorage.setItem('greenhub_cart', JSON.stringify([item]))
    }, mockItem)
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /결제하기/ }).click()
    await expect(page).toHaveURL(/\/checkout/, { timeout: 10_000 })
  })
})
