import { test, expect } from '@playwright/test'
import { loginViaCredentials } from './_helpers/auth'

const BASE = 'https://seller.greenlove.co.kr'

test.describe('셀러 배너 관리', () => {
  test('미인증 접근 시 로그인 페이지로 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/admin/banner`)
    // 인증되지 않으면 로그인 페이지로 redirect 되어야 함
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })

  test('로그인 페이지 정상 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await expect(page.locator('body')).toBeVisible()
    // 로그인 폼 요소 존재 확인
    const input = page.locator('input[type="email"], input[type="text"]')
    await expect(input.first()).toBeVisible()
  })
})

// 실제 로그인 후 토글 검증은 아래 블록에서 확장
// TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 환경변수 세팅 시 활성화
const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']

test.describe('셀러 배너 토글 (인증 필요)', () => {
  // admin 권한 계정 필요 — TEST_SELLER_EMAIL은 seller role이므로 /admin/banner 접근 불가
  test.skip(true, 'admin 권한 계정 필요 (TEST_SELLER_EMAIL은 seller role)')

  test('배너 활성화 토글 클릭 시 에러 없음', async ({ page }) => {
    await loginViaCredentials(page, BASE, sellerEmail!, sellerPassword!)

    await page.goto(`${BASE}/admin/banner`)
    await page.waitForSelector('text=히어로 배너 관리', { timeout: 10_000 })

    // 토글 클릭
    const toggle = page.locator('role=switch')
    await toggle.click()

    // JS 에러가 없어야 함
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.waitForTimeout(500)
    expect(errors.filter(e => e.includes('Cannot read properties of null'))).toHaveLength(0)
  })
})
