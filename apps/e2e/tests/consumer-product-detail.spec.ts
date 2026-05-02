import { test, expect } from '@playwright/test'

const BASE = 'https://greenlove.co.kr'

test.describe('Consumer — 상품 상세 페이지', () => {
  let productHref: string | null = null

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    const link = page.locator('a[href^="/products/"]').first()
    if (await link.count() > 0) {
      productHref = await link.getAttribute('href')
    }
  })

  test('홈 → 상품 클릭 → /products/[id] 이동', async ({ page }) => {
    if (!productHref) {
      test.skip(true, '홈에 상품 없음')
      return
    }
    await page.goto(BASE + productHref)
    await page.waitForLoadState('load')
    await expect(page).toHaveURL(/\/products\//)
  })

  test('상품 상세 — 뒤로가기 버튼 노출', async ({ page }) => {
    if (!productHref) {
      test.skip(true, '홈에 상품 없음')
      return
    }
    await page.goto(BASE + productHref)
    await page.waitForLoadState('load')
    // ProductTopBar — <button type="button"> 내 span 텍스트 "뒤로"
    const backBtn = page.getByRole('button', { name: '뒤로' })
    await expect(backBtn).toBeVisible()
  })

  test('상품 상세 — 이미지 영역 렌더링', async ({ page }) => {
    if (!productHref) {
      test.skip(true, '홈에 상품 없음')
      return
    }
    await page.goto(BASE + productHref)
    await page.waitForLoadState('load')
    const img = page.locator('img').first()
    await expect(img).toBeVisible()
  })

  test('상품 상세 — 가격 정보 표시 (숫자+원)', async ({ page }) => {
    if (!productHref) {
      test.skip(true, '홈에 상품 없음')
      return
    }
    await page.goto(BASE + productHref)
    await page.waitForLoadState('load')
    // "원" 텍스트가 포함된 요소 존재
    const priceEl = page.getByText(/\d{1,3}(,\d{3})*원/)
    await expect(priceEl.first()).toBeVisible()
  })

  test('상품 상세 — 담기 또는 참여 버튼 노출', async ({ page }) => {
    if (!productHref) {
      test.skip(true, '홈에 상품 없음')
      return
    }
    await page.goto(BASE + productHref)
    await page.waitForLoadState('load')
    // "장바구니 담기" or "공동구매 참여" or "바로 구매"
    const actionBtn = page.getByRole('button', {
      name: /장바구니|참여|구매|담기/,
    }).first()
    await expect(actionBtn).toBeVisible({ timeout: 10_000 })
  })

  test('상품 상세 — JS 에러 없음', async ({ page }) => {
    if (!productHref) {
      test.skip(true, '홈에 상품 없음')
      return
    }
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(BASE + productHref)
    await page.waitForLoadState('load')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad') && !e.includes('404')
    )
    expect(critical).toHaveLength(0)
  })

  test('존재하지 않는 상품 ID — 크래시 없음 (404 UI)', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/products/nonexistent-product-id-00000`)
    await page.waitForLoadState('load')
    // 페이지 자체가 크래시 없이 렌더되어야 함
    await expect(page.locator('body')).toBeVisible()
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad') && !e.includes('404')
    )
    expect(critical).toHaveLength(0)
  })
})
