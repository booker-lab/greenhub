import { expect, type Page, test } from '@playwright/test';
import { buildOrdersResponse, buildPaginatedOrders } from './_helpers/admin-orders-pagination';
import { ADMIN_STATE_PATH } from './_helpers/auth';
import { expectNoHorizontalOverflow, setMobileViewport } from './_helpers/responsive';

const BASE = process.env.SELLER_BASE ?? 'https://seller.greenlove.co.kr';
const adminEmail = process.env.TEST_ADMIN_EMAIL;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
const skipAuth = !adminEmail || !adminPassword;

type OrderStatus = 'PREPARING' | 'DELIVERING';

interface OrderFixture {
  id: string;
  orderNumber: string;
  storeId: string;
  userId: string;
  productName: string;
  buyerName: string;
  status: OrderStatus;
  totalAmount: number;
  deliveryMethod: string;
  createdAt: string;
}

const STORE = {
  id: 'store-page-alpha',
  name: '페이지난원',
  ownerId: 'owner-page',
  status: 'active',
  createdAt: '2026-05-20T00:00:00.000Z',
};

const BASE_ORDER: OrderFixture = {
  id: 'order-page-base',
  orderNumber: 'ORD-PAGE-BASE',
  storeId: STORE.id,
  userId: 'user-page',
  productName: '페이지 테스트 호접란',
  buyerName: '김페이지',
  status: 'PREPARING',
  totalAmount: 59_000,
  deliveryMethod: 'parcel',
  createdAt: '2026-05-29T01:00:00.000Z',
};

async function installFixture(page: Page) {
  const readUrls: string[] = [];
  const orders = buildPaginatedOrders(BASE_ORDER);
  await page.route('**/admin/stores', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ stores: [STORE], total: 1 }),
    });
  });
  await page.route(/\/admin\/orders(?:\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.resourceType() === 'document') {
      await route.continue();
      return;
    }

    readUrls.push(request.url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildOrdersResponse(request.url(), orders, true)),
    });
  });
  return readUrls;
}

async function openOrders(page: Page) {
  const readUrls = await installFixture(page);
  await page.goto(`${BASE}/admin/orders`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('전체 주문')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('combobox', { name: '페이지 크기' })).toBeVisible();
  return readUrls;
}

async function selectOption(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('Admin - 주문 고급 페이지네이션', () => {
  test.use({ storageState: ADMIN_STATE_PATH });
  test.skip(skipAuth, 'TEST_ADMIN_EMAIL/PASSWORD 미설정 - 어드민 인증 검증을 건너뜁니다');

  test('총 건수와 페이지 번호를 표시하고 임의 페이지 이동을 요청한다', async ({ page }) => {
    const readUrls = await openOrders(page);

    await expect(page.getByText('(30건)')).toBeVisible();
    await expect(page.getByText('1 / 1 페이지')).toHaveCount(0);
    await selectOption(page, '페이지 크기', '25개');
    await expect(page.getByText('1 / 2 페이지')).toBeVisible();

    await page.getByRole('button', { name: '2', exact: true }).click();
    await expect(page.getByText('2 / 2 페이지')).toBeVisible();
    await expect(page.getByText('ORD-PAGE-05').filter({ visible: true })).toBeVisible();
    await expect(page.getByText('ORD-PAGE-01').filter({ visible: true })).toBeVisible();
    expect(readUrls.some((url) => url.includes('page=2'))).toBe(true);
    expect(readUrls.some((url) => url.includes('limit=25'))).toBe(true);
  });

  test('필터 변경은 1페이지로 복귀하고 모바일 폭을 지킨다', async ({ page }) => {
    await setMobileViewport(page);
    const readUrls = await openOrders(page);

    await selectOption(page, '페이지 크기', '25개');
    await page.getByRole('button', { name: '2', exact: true }).click();
    await expect(page.getByText('2 / 2 페이지')).toBeVisible();

    await selectOption(page, '정렬', '오래된순');
    await expect(page.getByText('1 / 2 페이지')).toBeVisible();
    await expect(readUrls.at(-1)).toContain('page=1');
    await expect(readUrls.at(-1)).toContain('sort=createdAt_asc');
    await expectNoHorizontalOverflow(page);
  });
});
