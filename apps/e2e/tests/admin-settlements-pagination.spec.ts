import { expect, type Page, test } from '@playwright/test';
import { ADMIN_STATE_PATH } from './_helpers/auth';

const BASE = process.env.SELLER_BASE ?? 'https://seller.greenlove.co.kr';
const adminEmail = process.env.TEST_ADMIN_EMAIL;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
const skipAuth = !adminEmail || !adminPassword;

function settlementAt(index: number) {
  return new Date(Date.UTC(2026, 4, 29, 3, index)).toISOString();
}

function createSettlement(index: number) {
  return {
    id: `set-page-${String(index).padStart(3, '0')}`,
    storeId: 'store-page-001',
    orderId: `order-page-${index}`,
    totalAmount: 10_000 + index,
    platformFee: 1_000,
    netAmount: 9_000 + index,
    status: 'confirmed',
    settledAt: settlementAt(101 - index),
    confirmedAt: settlementAt(101 - index),
    paidAt: null,
  };
}

async function installPaginationFixture(page: Page) {
  const readUrls: string[] = [];
  const firstPage = Array.from({ length: 100 }, (_, index) => createSettlement(index + 1));
  const secondPage = [createSettlement(101)];

  await page.route('**/admin/stores', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || !request.headers().authorization) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        stores: [{ id: 'store-page-001', name: '페이지 정원' }],
        total: 1,
      }),
    });
  });

  await page.route(/\/admin\/settlements(?:\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || !request.headers().authorization) {
      await route.continue();
      return;
    }

    readUrls.push(request.url());
    const url = new URL(request.url());
    const hasCursor = url.searchParams.has('cursor');

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        settlements: hasCursor ? secondPage : firstPage,
        total: hasCursor ? secondPage.length : firstPage.length,
        nextCursor: hasCursor ? null : firstPage.at(-1)?.settledAt,
      }),
    });
  });

  return { readUrls };
}

test.describe('Admin - 정산 페이지네이션', () => {
  test.use({ storageState: ADMIN_STATE_PATH });
  test.skip(skipAuth, 'TEST_ADMIN_EMAIL/PASSWORD 미설정 - 어드민 인증 검증을 건너뜁니다');

  test('더 보기는 다음 커서 페이지를 이어 붙이고 마지막에 사라진다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const state = await installPaginationFixture(page);

    await page.goto(`${BASE}/admin/settlements`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('정산 목록')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('table tbody tr')).toHaveCount(100);
    await expect(page.getByText('(100)')).toBeVisible();

    await page.getByRole('button', { name: '더 보기' }).click();

    await expect(page.locator('table tbody tr')).toHaveCount(101);
    await expect(page.getByText('(101)')).toBeVisible();
    await expect(page.getByRole('button', { name: '더 보기' })).toHaveCount(0);
    expect(state.readUrls.some((url) => url.includes('limit=100'))).toBe(true);
    expect(state.readUrls.some((url) => url.includes('cursor='))).toBe(true);
  });
});
