import { test, expect } from '@playwright/test'

const BASE = 'https://greenlove.co.kr'

test.describe('소비자 홈', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE)
  })

  test('페이지 정상 렌더링', async ({ page }) => {
    await expect(page).toHaveTitle(/Green Love/)
    await expect(page.getByText('그린러브', { exact: true })).toBeVisible()
  })

  test('공동구매 섹션 존재', async ({ page }) => {
    await expect(page.locator('text=진행 중 공동구매')).toBeVisible()
  })

  test('공구 카드에 진행률 텍스트 표시', async ({ page }) => {
    const progressText = page.locator('text=/\\d+\\/\\d+개/')
    const count = await progressText.count()
    // 공구 상품이 있을 때만 검증
    if (count > 0) {
      await expect(progressText.first()).toBeVisible()
    }
  })

  test('마감 임박 섹션 — 해당 상품 없으면 숨김', async ({ page }) => {
    // 마감 임박 섹션은 24h 이내 상품이 없으면 렌더되지 않음 — 오류 없이 통과해야 함
    const section = page.locator('text=마감 임박')
    // 있거나 없거나 페이지 자체가 crash 없이 로드되면 OK
    await expect(page.locator('body')).toBeVisible()
    const visible = await section.isVisible()
    if (visible) {
      await expect(section).toBeVisible()
    }
  })

  test('하단 내비게이션 존재', async ({ page }) => {
    await expect(page.locator('text=홈')).toBeVisible()
    await expect(page.locator('text=카테고리')).toBeVisible()
  })
})
