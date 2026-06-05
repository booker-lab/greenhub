import { expect, type Page, test } from '@playwright/test';
import { ADMIN_STATE_PATH } from './_helpers/auth';

const BASE = process.env.SELLER_BASE ?? 'https://seller.greenlove.co.kr';
const adminEmail = process.env.TEST_ADMIN_EMAIL;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
const skipAuth = !adminEmail || !adminPassword;

const STORE = {
  id: 'store-active-beta',
  name: '베타화훼',
  ownerId: 'owner-beta',
  status: 'active',
};

const ORDER = {
  id: 'order-delivering-beta',
  orderNumber: 'ORD-DEL-002',
  storeId: STORE.id,
  userId: 'user-beta',
  productName: '핑크 덴드로비움',
  buyerName: '박베타',
  status: 'DELIVERING',
  totalAmount: 83_000,
  deliveryMethod: 'parcel',
  saleType: 'group',
  quantity: 1,
  courierCompany: 'CJ대한통운',
  trackingNumber: '1234567890123456789012345678901234567890',
  createdAt: '2026-05-29T02:00:00.000Z',
};

async function installTrackingFixture(page: Page) {
  const order = { ...ORDER };
  const trackingRequests: Array<{
    orderId: string;
    courierCompany: string;
    trackingNumber: string;
  }> = [];

  await page.route(/\/admin\/orders\/[^/]+$/, async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || !request.headers().authorization) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        order,
        store: STORE,
        buyer: { id: order.userId, name: order.buyerName },
        payment: { id: order.id, amount: order.totalAmount, status: 'paid' },
        items: [
          {
            productId: null,
            productName: order.productName,
            quantity: order.quantity,
            totalAmount: order.totalAmount,
          },
        ],
        timeline: [{ label: '주문 생성', status: order.status, at: order.createdAt }],
      }),
    });
  });

  await page.route(/\/admin\/orders\/[^/]+\/tracking$/, async (route) => {
    const request = route.request();
    if (request.method() !== 'PATCH' || !request.headers().authorization) {
      await route.continue();
      return;
    }

    const body = request.postDataJSON() as {
      courierCompany?: string;
      trackingNumber?: string;
    };
    order.courierCompany = body.courierCompany?.trim() ?? '';
    order.trackingNumber = body.trackingNumber?.trim() ?? '';
    trackingRequests.push({
      orderId: order.id,
      courierCompany: order.courierCompany,
      trackingNumber: order.trackingNumber,
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, orderId: order.id }),
    });
  });

  return trackingRequests;
}

test.describe('Admin - 주문 송장 사후 정정', () => {
  test.use({ storageState: ADMIN_STATE_PATH });
  test.skip(skipAuth, 'TEST_ADMIN_EMAIL/PASSWORD 미설정 - 어드민 인증 검증을 건너뜁니다');

  test('정식 상세에서 송장 정보를 사후 정정한다', async ({ page }) => {
    const trackingRequests = await installTrackingFixture(page);

    await page.goto(`${BASE}/admin/orders/${ORDER.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '주문 정식 상세' })).toBeVisible();
    await expect(
      page.getByText('CJ대한통운 / 1234567890123456789012345678901234567890'),
    ).toBeVisible();

    await page.getByRole('button', { name: '송장 정정' }).click();
    const dialog = page.getByRole('dialog', { name: '송장 정정' });
    await dialog.getByLabel('택배사').fill('한진');
    await dialog.getByLabel('운송장번호').fill('9876543210');
    await dialog.getByRole('button', { name: '저장' }).click();

    await expect(page.getByText('한진 / 9876543210')).toBeVisible();
    await expect
      .poll(() => trackingRequests)
      .toContainEqual({
        orderId: ORDER.id,
        courierCompany: '한진',
        trackingNumber: '9876543210',
      });
  });
});
