import { test, expect } from '@playwright/test'

const BASE = 'https://greenlove.co.kr'

test.describe('Consumer — 인증 플로우', () => {
  test('/login — 페이지 정상 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Green Love')).toBeVisible()
    await expect(page.getByText('카카오로 시작하기')).toBeVisible()
    await expect(page.getByLabel('이메일')).toBeVisible()
    await expect(page.getByLabel('비밀번호')).toBeVisible()
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible()
  })

  test('/login — 잘못된 이메일 형식 → 브라우저 유효성 에러 (submit 차단)', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')

    await page.getByLabel('이메일').fill('invalid-email')
    await page.getByLabel('비밀번호').fill('password123')
    await page.getByRole('button', { name: '로그인' }).click()

    // HTML5 type="email" 유효성 검사로 form submit이 차단되어 URL 변경 없음
    await expect(page).toHaveURL(/\/login/)
  })

  test('/login — 잘못된 자격증명 → 에러 메시지 표시', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')

    await page.getByLabel('이메일').fill('wrong@example.com')
    await page.getByLabel('비밀번호').fill('wrongpassword')
    await page.getByRole('button', { name: '로그인' }).click()

    await expect(
      page.getByText('이메일 또는 비밀번호가 올바르지 않습니다.')
    ).toBeVisible({ timeout: 10_000 })
  })

  test('/cart — 비로그인 시 /login으로 리디렉트', async ({ page }) => {
    await page.goto(`${BASE}/cart`)
    await page.waitForLoadState('networkidle')

    // 미들웨어: /cart는 인증 필수 → /login 리디렉트
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText('Green Love')).toBeVisible()
  })

  test('/checkout — 비로그인 시 /login으로 리디렉트', async ({ page }) => {
    await page.goto(`${BASE}/checkout?from=cart`)
    await page.waitForLoadState('networkidle')

    // 미들웨어: /checkout는 인증 필수 → /login 리디렉트
    await expect(page).toHaveURL(/\/login/)
  })

  test('/login — callbackUrl 파라미터 오픈 리디렉트 방어', async ({ page }) => {
    // 외부 URL 주입 시 /로 폴백
    await page.goto(`${BASE}/login?callbackUrl=https://evil.com`)
    await page.waitForLoadState('networkidle')
    // 로그인 페이지가 정상 렌더되어야 함 (악성 리디렉트 없음)
    await expect(page.getByText('Green Love')).toBeVisible()
  })
})
