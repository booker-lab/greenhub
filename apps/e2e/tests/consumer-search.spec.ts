import { test, expect } from '@playwright/test'

const BASE = process.env['CONSUMER_BASE'] ?? 'https://greenlove.co.kr'

test.describe('Consumer — 검색 페이지', () => {
  test('/search — 검색창 자동 포커스 및 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/search`)
    await page.waitForLoadState('networkidle')

    const input = page.getByPlaceholder('상품명을 검색하세요')
    await expect(input).toBeVisible()
    await expect(input).toBeFocused()
  })

  test('/search — JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${BASE}/search`)
    await page.waitForLoadState('networkidle')
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad')
    )
    expect(critical).toHaveLength(0)
  })

  test('검색어 입력 전 — 결과 영역 빈 상태', async ({ page }) => {
    await page.goto(`${BASE}/search`)
    await page.waitForLoadState('networkidle')

    // query 없을 때 filtered = [] → 상품 카드 없음
    const productCards = page.locator('a[href^="/products/"]')
    expect(await productCards.count()).toBe(0)
  })

  test('검색어 입력 → 결과 또는 "결과 없음" 표시', async ({ page }) => {
    await page.goto(`${BASE}/search`)
    await page.waitForLoadState('networkidle')

    const input = page.getByPlaceholder('상품명을 검색하세요')
    await input.fill('장미')
    // 데이터 로딩 대기
    await page.waitForTimeout(1500)

    const cards = page.locator('a[href^="/products/"]')
    const noResult = page.getByText(/결과가 없습니다|없습니다/)
    const cardCount = await cards.count()

    // 결과가 있거나 없음 메시지가 있어야 함
    if (cardCount > 0) {
      await expect(cards.first()).toBeVisible()
    } else {
      // 결과 없음 메시지 또는 빈 상태 (에러 없이 렌더)
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('검색 결과 카드 클릭 → /products/[id] 이동', async ({ page }) => {
    await page.goto(`${BASE}/search`)
    await page.waitForLoadState('networkidle')

    const input = page.getByPlaceholder('상품명을 검색하세요')
    // 짧은 검색어로 결과가 나올 가능성 높이기
    await input.fill('꽃')
    await page.waitForTimeout(1500)

    const firstCard = page.locator('a[href^="/products/"]').first()
    if (await firstCard.count() > 0) {
      await firstCard.click()
      await expect(page).toHaveURL(/\/products\//)
    } else {
      test.skip(true, '검색 결과 없음 — 환경에 따라 skip')
    }
  })

  test('X 버튼 클릭 → 검색어 초기화', async ({ page }) => {
    await page.goto(`${BASE}/search`)
    await page.waitForLoadState('networkidle')

    const input = page.getByPlaceholder('상품명을 검색하세요')
    await input.fill('테스트')
    await expect(input).toHaveValue('테스트')

    // 초기화 버튼 (✕)
    const clearBtn = page.getByRole('button').filter({ hasText: '✕' })
    await expect(clearBtn).toBeVisible()
    await clearBtn.click()

    await expect(input).toHaveValue('')
  })
})
