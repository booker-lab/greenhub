import { test, expect } from '@playwright/test'
import { AUTH_STATE_PATH } from './_helpers/auth'
import { readConsumerFeatures } from './_helpers/consumer-features'

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

const consumerEmail = process.env['TEST_CONSUMER_EMAIL']
const consumerPassword = process.env['TEST_CONSUMER_PASSWORD']
const skipAuth = !consumerEmail || !consumerPassword

const GUEST_ITEM = {
  productId: 'test-guest-product-1',
  name: '비회원 테스트 상품',
  price: 12000,
  quantity: 2,
  image: '',
  saleType: 'normal',
  storeId: 'store-1',
  deliveryMethod: 'direct',
}

// 비로그인 /cart 기대값은 배포된 빌드의 비회원 장바구니(guest-cart) 토글로 갈린다.
// 토글은 홈의 <meta name="greenhub-features">로 읽는다(리다이렉트 여부로 추정하지 않는다).
//   - 꺼짐: proxy가 /login?callbackUrl=/cart로 보낸다.
//   - 켜짐: /cart가 열리고, 주문 버튼이 로그인(복귀 주소 /cart)으로 보낸다.
test.describe('Consumer — 장바구니 (비인증)', () => {
  test('/cart — 비로그인 진입 시 토글에 맞는 화면', async ({ page }) => {
    const features = await readConsumerFeatures(page, BASE)
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')
    if (features.isOn('guest-cart')) {
      await expect(page).toHaveURL(/\/cart$/)
      await expect(page.getByText('장바구니가 비어있습니다.')).toBeVisible()
      await expect(page.getByRole('link', { name: '쇼핑하러 가기' })).toBeVisible()
    } else {
      await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fcart$/)
    }
  })

  test('/cart — 진입 후 JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('/cart — 담은 상품이 있을 때 비로그인 주문 흐름', async ({ page }) => {
    const features = await readConsumerFeatures(page, BASE)
    // readConsumerFeatures가 홈을 열었으므로 같은 출처 localStorage에 상품을 넣는다.
    await page.evaluate((item) => {
      localStorage.setItem('greenhub_cart', JSON.stringify([item]))
    }, GUEST_ITEM)
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')

    if (!features.isOn('guest-cart')) {
      // 꺼짐: 담은 상품이 있어도 장바구니를 보여주지 않고 로그인으로 보낸다.
      await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fcart$/)
      await expect(page.getByText(GUEST_ITEM.name)).toHaveCount(0)
      return
    }

    // 켜짐: 로그인 없이 담은 상품·금액을 보여주고, 결제 버튼 대신 로그인 주문 버튼을 둔다.
    await expect(page).toHaveURL(/\/cart$/)
    await expect(page.getByText(GUEST_ITEM.name)).toBeVisible()
    // 24,000원은 상품 행 + 합계 두 곳에 나온다.
    await expect(page.getByText('24,000원')).toHaveCount(2)
    const orderButton = page.getByRole('button', { name: '로그인하고 주문하기' })
    await expect(orderButton).toBeVisible()
    await expect(page.getByRole('button', { name: /결제/ })).toHaveCount(0)

    // 주문하면 로그인 화면으로 가고, 로그인 뒤 같은 장바구니(/cart)로 돌아올 복귀 주소를 싣는다.
    await orderButton.click()
    await page.waitForURL(/\/login\?/, { timeout: 10_000 })
    const callbackUrl = new URL(page.url()).searchParams.get('callbackUrl') ?? ''
    expect(new URL(callbackUrl, BASE).pathname).toBe('/cart')
    // 복귀 주소가 절대 주소로 와도 로그인 화면이 왜 로그인하는지 알려 준다.
    await expect(page.getByRole('status').filter({ hasText: '주문하려면 로그인이 필요해요' })).toBeVisible()
    // 담은 상품은 로그인 화면으로 넘어가도 그대로 남는다.
    const stored = await page.evaluate(() => localStorage.getItem('greenhub_cart'))
    expect(JSON.parse(stored ?? '[]')).toEqual([GUEST_ITEM])
  })
})

// ── 인증 후 장바구니 기능 테스트 ────────────────────────────────────────

test.describe('Consumer — 장바구니 (인증)', () => {
  // #CL-23: globalSetup이 발급한 세션 쿠키 재사용 — spec별 로그인 호출 제거
  test.use({ storageState: AUTH_STATE_PATH })

  test.skip(skipAuth, '환경변수 TEST_CONSUMER_EMAIL / TEST_CONSUMER_PASSWORD 필요')

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
