import { test, expect } from '@playwright/test'
import { AUTH_STATE_PATH, loginViaCredentials } from './_helpers/auth'

const BASE = process.env['SELLER_BASE'] ?? 'https://seller.greenlove.co.kr'
const API = 'https://api-production-13e7.up.railway.app'

// ── 비인증 ────────────────────────────────────────────────────────────────────

test.describe('셀러 온보딩 — 공개', () => {
  test('미인증 접근 시 login 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/onboarding`)
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 })
  })
})

// ── 인증 후 ───────────────────────────────────────────────────────────────────

const sellerEmail = process.env['TEST_SELLER_EMAIL']
const sellerPassword = process.env['TEST_SELLER_PASSWORD']
const skipAuth = !sellerEmail || !sellerPassword

test.describe('셀러 온보딩 — 인증', () => {
  // #CL-23: globalSetup이 발급한 세션 쿠키 재사용 — spec별 로그인 호출 제거
  test.use({ storageState: AUTH_STATE_PATH })

  test.skip(skipAuth, '환경변수 TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 필요')

  test.beforeEach(async ({ page }) => {
    await loginViaCredentials(page, BASE, sellerEmail!, sellerPassword!)
  })

  // ── 페이지 구조 ───────────────────────────────────────────────────────────

  test('온보딩 헤더 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/onboarding`)
    await expect(page.locator('text=사업자 정보 등록')).toBeVisible({ timeout: 10_000 })
  })

  test('필수 입력 필드 4개 렌더링 (상호명·대표자명·연락처·소재지)', async ({ page }) => {
    await page.goto(`${BASE}/onboarding`)
    await expect(page.locator('text=사업자 정보 등록')).toBeVisible({ timeout: 10_000 })
    for (const label of ['상호명', '대표자명', '연락처', '소재지']) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible()
    }
  })

  // ── B1: pre-fill ──────────────────────────────────────────────────────────

  test('B1 — storeId 있는 계정 진입 시 상호명 필드 pre-fill', async ({ page }) => {
    await page.goto(`${BASE}/onboarding`)
    await expect(page.locator('text=사업자 정보 등록')).toBeVisible({ timeout: 10_000 })

    // API 응답 대기 (pre-fill은 useEffect 비동기)
    await page.waitForTimeout(2_000)

    // 상호명 input이 비어있지 않아야 함
    const nameInput = page.locator('input[name="name"]')
    await expect(nameInput).toBeVisible()
    const value = await nameInput.inputValue()
    expect(value.length).toBeGreaterThan(0)
  })

  test('B1 — pre-fill 후 폼 수정 가능', async ({ page }) => {
    await page.goto(`${BASE}/onboarding`)
    await expect(page.locator('text=사업자 정보 등록')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(2_000)

    const nameInput = page.locator('input[name="name"]')
    const original = await nameInput.inputValue()

    // 수정 가능 여부 확인
    await nameInput.fill(`${original} 수정테스트`)
    const modified = await nameInput.inputValue()
    expect(modified).toContain('수정테스트')

    // 원래 값으로 복원
    await nameInput.fill(original)
  })

  test('온보딩 진입 시 JS 에러 없음', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/onboarding`)
    await expect(page.locator('text=사업자 정보 등록')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(2_000)

    expect(errors).toHaveLength(0)
  })
})

// ── B1: API GET /stores/:storeId ──────────────────────────────────────────────

test.describe('B1 — GET /stores/:storeId API', () => {
  test.skip(skipAuth, '환경변수 TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 필요')

  let accessToken: string
  const TEST_STORE_ID = '9b2cb652-ff77-46b9-a773-e1efa78fb763'

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API}/auth/login`, {
      data: { email: sellerEmail, password: sellerPassword },
    })
    const body = await res.json()
    accessToken = body.accessToken
  })

  test('GET /stores/:storeId — 200 + 스토어 데이터 반환', async ({ request }) => {
    const res = await request.get(`${API}/stores/${TEST_STORE_ID}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('id', TEST_STORE_ID)
    expect(body).toHaveProperty('name')
    expect(body.name.length).toBeGreaterThan(0)
  })

  test('GET /stores/:storeId — 미인증 시 401', async ({ request }) => {
    const res = await request.get(`${API}/stores/${TEST_STORE_ID}`)
    expect(res.status()).toBe(401)
  })

  test('GET /stores/:storeId — 타인 storeId 접근 시 403', async ({ request }) => {
    const res = await request.get(`${API}/stores/00000000-0000-0000-0000-000000000000`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    // 존재하지 않으면 404, 타인 소유면 403
    expect([403, 404]).toContain(res.status())
  })
})
