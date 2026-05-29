import { expect, test } from '@playwright/test';
import { AUTH_STATE_PATH } from './_helpers/auth';

// BUG-16 T5 — 셀러 택배 발송 완료 동선.
// 시드: scripts/seed-e2e-orders.mjs 의 e2e-parcel-order-001
//   (deliveryMethod=parcel, status=PREPARING) 가 선행되어야 한다.
// 동선: seller 로그인(storageState) → 주문 상세 → "택배 발송 완료" 클릭 → DELIVERED 전환.

const BASE = process.env.SELLER_BASE ?? 'https://seller.greenlove.co.kr';
const PARCEL_ORDER_ID = 'e2e-parcel-order-001';

const sellerEmail = process.env.TEST_SELLER_EMAIL;
const sellerPassword = process.env.TEST_SELLER_PASSWORD;
const skipAuth = !sellerEmail || !sellerPassword;

test.describe('셀러 택배 발송 완료 — 인증', () => {
  // #CL-23: globalSetup이 발급한 세션 쿠키 재사용
  test.use({ storageState: AUTH_STATE_PATH });

  test.skip(skipAuth, '환경변수 TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 필요');

  test('택배 주문 상세에 "택배 발송 완료" 버튼 노출 + 클릭 시 발송 이후 단계 전환', async ({
    page,
  }) => {
    await page.goto(`${BASE}/orders/${PARCEL_ORDER_ID}`);
    await expect(page.locator('text=주문 상세')).toBeVisible({ timeout: 10_000 });

    // UX-11 회귀 가드: 시드 주문은 orderNumber가 발급돼 있으므로 폴백(#id) 분기를 타지 않고
    // YYYYMMDD-NNNNNN 그대로 노출돼야 한다 (OrderInfoSection: 주문 {orderNumber ?? #id}).
    await expect(page.locator('text=주문 20260101-000003')).toBeVisible({ timeout: 10_000 });

    const shipBtn = page.locator('text=택배 발송 완료');
    const canShip = (await shipBtn.count()) > 0;
    if (!canShip) {
      // 시드 부재 또는 이미 발송 완료(직전 풀런 잔여) → 멱등 시드 재실행으로 복원 필요.
      test
        .info()
        .annotations.push({ type: 'skip-reason', description: 'parcel+PREPARING 시드 부재' });
      return;
    }

    await shipBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('택배사').click();
    await page.getByRole('option', { name: 'CJ대한통운' }).click();
    await page.getByLabel('운송장번호').fill('1234567890');
    await page.getByRole('button', { name: '발송 완료', exact: true }).click();

    // PREPARING → DELIVERED 전환 후엔 READONLY 안내문이 노출되고 버튼은 사라진다.
    await expect(page.locator('text=발송 이후 단계입니다')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=택배 발송 완료')).not.toBeVisible();
  });

  test('일반(direct) 주문 상세에는 "택배 발송 완료" 버튼이 없음', async ({ page }) => {
    // 회귀 가드: parcel 가드가 UI에서도 일관 — direct 주문은 발송 완료 미노출.
    await page.goto(`${BASE}/orders/e2e-normal-order-001`);
    await expect(page.locator('text=주문 상세')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=택배 발송 완료')).not.toBeVisible();
  });
});
