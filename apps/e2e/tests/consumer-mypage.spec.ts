import { expect, test } from '@playwright/test';
import { AUTH_STATE_PATH } from './_helpers/auth';

const BASE = process.env.CONSUMER_BASE ?? 'https://greenlove.co.kr';

const consumerEmail = process.env.TEST_CONSUMER_EMAIL;
const consumerPassword = process.env.TEST_CONSUMER_PASSWORD;
const skipAuth = !consumerEmail || !consumerPassword;

// /mypage/* 는 미들웨어로 보호됨 → 비로그인 시 /login 리디렉트
test.describe('Consumer — 마이페이지 (비인증)', () => {
  test('/mypage — 비로그인 시 /login 리디렉트', async ({ page }) => {
    await page.goto(`${BASE}/mypage`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/login/);
  });

  test('/mypage — JS 에러 없음', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/mypage`);
    await page.waitForLoadState('networkidle');
    const critical = errors.filter((e) => !e.includes('hydration') && !e.includes('ChunkLoad'));
    expect(critical).toHaveLength(0);
  });

  test('/mypage/addresses — 비로그인 시 /login 리디렉트', async ({ page }) => {
    await page.goto(`${BASE}/mypage/addresses`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/login/);
  });

  test('/mypage/notifications — 비로그인 시 /login 리디렉트', async ({ page }) => {
    await page.goto(`${BASE}/mypage/notifications`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/login/);
  });

  test('/mypage/orders/[id] — 비로그인 시 /login 리디렉트', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/mypage/orders/nonexistent-order-id-00000`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/login/);
    const critical = errors.filter(
      (e) => !e.includes('hydration') && !e.includes('ChunkLoad') && !e.includes('404'),
    );
    expect(critical).toHaveLength(0);
  });

  test('로그인 페이지 — BottomNav MY 탭 노출', async ({ page }) => {
    await page.goto(`${BASE}/mypage`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('MY')).toBeVisible();
  });
});

// ── 인증 후 마이페이지 테스트 ─────────────────────────────────────────────

test.describe('Consumer — 마이페이지 (인증)', () => {
  // #CL-23: globalSetup이 발급한 세션 쿠키 재사용 — spec별 로그인 호출 제거
  test.use({ storageState: AUTH_STATE_PATH });

  test.skip(skipAuth, '환경변수 TEST_CONSUMER_EMAIL / TEST_CONSUMER_PASSWORD 필요');

  test('프로필 — 이메일 표시', async ({ page }) => {
    await page.goto(`${BASE}/mypage`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/@/)).toBeVisible({ timeout: 10_000 });
  });

  test('주문 목록 — 고정 택배 주문의 일반 주문 구분과 확정 가능 신호 표시', async ({ page }) => {
    await page.goto(`${BASE}/mypage`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('일반 주문')).toBeVisible({ timeout: 10_000 });
    const deliveredParcelCard = page
      .locator('[data-testid="order-card"]')
      .filter({ hasText: '확정 가능' })
      .filter({ hasText: '택배' })
      .first();
    await expect(deliveredParcelCard).toBeVisible();
    await expect(deliveredParcelCard).toContainText('배송 완료');
  });

  test('/mypage/addresses — JS 에러 없이 렌더링', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/mypage/addresses`);
    await page.waitForLoadState('networkidle');
    const critical = errors.filter((e) => !e.includes('hydration') && !e.includes('ChunkLoad'));
    expect(critical).toHaveLength(0);
    await expect(page.locator('body')).toBeVisible();
  });

  test('/mypage/notifications — JS 에러 없이 렌더링', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/mypage/notifications`);
    await page.waitForLoadState('networkidle');
    const critical = errors.filter((e) => !e.includes('hydration') && !e.includes('ChunkLoad'));
    expect(critical).toHaveLength(0);
    await expect(page.locator('body')).toBeVisible();
  });

  test('택배 주문 상세 — 판매자가 저장한 택배사와 운송장번호 표시', async ({ page }) => {
    await page.goto(`${BASE}/mypage/orders/e2e-parcel-delivered-order-001`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('구매 확정이 가능합니다')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('택배 배송 정보')).toBeVisible();
    await expect(page.getByText('택배사')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('CJ대한통운')).toBeVisible();
    await expect(page.getByText('운송장번호')).toBeVisible();
    await expect(page.getByText('1234567890')).toBeVisible();

    const reviewRoute = '**/stores/*/orders/e2e-parcel-delivered-order-001/review';
    await page.route(reviewRoute, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );
    await page.getByRole('button', { name: '구매 확정', exact: true }).click();
    await expect(page.getByText('구매 확정에 실패했습니다.')).toBeVisible();

    await page.unroute(reviewRoute);
    await page.getByRole('button', { name: '구매 확정', exact: true }).click();
    await expect(page.getByRole('button', { name: '✓ 구매 확정 완료' })).toBeVisible();
  });
});
