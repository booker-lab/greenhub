import { expect, type Page, test } from '@playwright/test';
import { ADMIN_STATE_PATH } from './_helpers/auth';

const BASE = process.env.SELLER_BASE ?? 'https://seller.greenlove.co.kr';

const adminEmail = process.env.TEST_ADMIN_EMAIL;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
const skipAuth = !adminEmail || !adminPassword;

type OrderStatus =
  | 'PENDING'
  | 'RECRUITING'
  | 'ACCEPTED'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'DELIVERING'
  | 'HUB_ARRIVED'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'REVIEWED'
  | 'CANCELLED';

interface OrderFixture {
  id: string;
  orderNumber: string;
  storeId: string;
  userId: string;
  productId?: string;
  productName?: string;
  buyerName?: string;
  buyerPhone?: string | null;
  status: OrderStatus;
  totalAmount: number;
  deliveryMethod: string;
  saleType?: string;
  quantity?: number;
  deliveryAddress?: {
    address: string;
    addressDetail: string;
    zipCode: string;
  };
  requestedDeliveryDate?: string | null;
  preparedAt?: string | null;
  courierCompany?: string | null;
  trackingNumber?: string | null;
  cancelReason?: string | null;
  createdAt: string;
  updatedAt?: string;
}

interface StoreFixture {
  id: string;
  name: string;
  ownerId: string;
  status: 'active' | 'archived';
  createdAt: string;
}

interface OrdersMockState {
  readUrls: string[];
  refundRequests: Array<{ orderId: string; reason?: string }>;
}

const STORES: StoreFixture[] = [
  {
    id: 'store-active-alpha',
    name: '알파난원',
    ownerId: 'owner-alpha',
    status: 'active',
    createdAt: '2026-05-20T00:00:00.000Z',
  },
  {
    id: 'store-active-beta',
    name: '베타화훼',
    ownerId: 'owner-beta',
    status: 'active',
    createdAt: '2026-05-21T00:00:00.000Z',
  },
  {
    id: 'store-archived-gamma',
    name: '감마치운농장',
    ownerId: 'owner-gamma',
    status: 'archived',
    createdAt: '2026-05-22T00:00:00.000Z',
  },
];

const ORDERS: OrderFixture[] = [
  {
    id: 'order-preparing-alpha',
    orderNumber: 'ORD-PRE-001',
    storeId: 'store-active-alpha',
    userId: 'user-alpha',
    productId: 'product-alpha',
    productName: '호접란 3대',
    buyerName: '김알파',
    buyerPhone: '010-1111-2222',
    status: 'PREPARING',
    totalAmount: 59_000,
    deliveryMethod: 'parcel',
    saleType: 'normal',
    quantity: 2,
    deliveryAddress: {
      address: '서울시 강남구 테헤란로 1',
      addressDetail: '101호',
      zipCode: '06100',
    },
    requestedDeliveryDate: '2026-05-30T00:00:00.000Z',
    preparedAt: '2026-05-29T09:00:00.000Z',
    createdAt: '2026-05-29T01:00:00.000Z',
    updatedAt: '2026-05-29T01:30:00.000Z',
  },
  {
    id: 'order-delivering-beta',
    orderNumber: 'ORD-DEL-002',
    storeId: 'store-active-beta',
    userId: 'user-beta',
    productName: '핑크 덴드로비움',
    buyerName: '박베타',
    status: 'DELIVERING',
    totalAmount: 83_000,
    deliveryMethod: 'parcel',
    saleType: 'group',
    quantity: 1,
    deliveryAddress: {
      address: '부산시 해운대구 센텀중앙로 2',
      addressDetail: '202호',
      zipCode: '48000',
    },
    courierCompany: 'CJ대한통운',
    trackingNumber: '123456789012',
    createdAt: '2026-05-29T02:00:00.000Z',
  },
  {
    id: 'order-reviewed-gamma',
    orderNumber: 'ORD-REV-003',
    storeId: 'store-archived-gamma',
    userId: 'user-gamma',
    status: 'REVIEWED',
    totalAmount: 41_000,
    deliveryMethod: 'parcel',
    createdAt: '2026-05-29T03:00:00.000Z',
  },
  {
    id: 'order-cancelled-alpha',
    orderNumber: 'ORD-CAN-004',
    storeId: 'store-active-alpha',
    userId: 'user-delta',
    status: 'CANCELLED',
    totalAmount: 25_000,
    deliveryMethod: 'parcel',
    createdAt: '2026-05-29T04:00:00.000Z',
  },
];

function filterOrders(requestUrl: string): OrderFixture[] {
  const url = new URL(requestUrl);
  const storeId = url.searchParams.get('storeId');
  const status = url.searchParams.get('status');
  return ORDERS.filter((order) => {
    if (storeId && order.storeId !== storeId) return false;
    if (status && order.status !== status) return false;
    return true;
  });
}

async function installFastInterval(page: Page) {
  await page.addInitScript(() => {
    const originalSetInterval = window.setInterval.bind(window);
    Reflect.set(window, '__adminOrdersIntervalDelays', []);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      (
        window as unknown as { __adminOrdersIntervalDelays: number[] }
      ).__adminOrdersIntervalDelays.push(timeout ?? 0);
      return originalSetInterval(handler, 20, ...args);
    }) as typeof window.setInterval;
  });
}

async function installOrdersApiFixture(page: Page): Promise<OrdersMockState> {
  const state: OrdersMockState = { readUrls: [], refundRequests: [] };

  await page.route('**/admin/stores', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || !request.headers().authorization) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ stores: STORES, total: STORES.length }),
    });
  });

  await page.route(/\/admin\/orders(?:\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || !request.headers().authorization) {
      await route.continue();
      return;
    }

    state.readUrls.push(request.url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: filterOrders(request.url()), total: ORDERS.length }),
    });
  });

  await page.route(/\/admin\/orders\/[^/]+\/refund$/, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    const orderId = new URL(request.url()).pathname.split('/').at(-2) ?? '';
    const body = (request.postDataJSON() ?? {}) as { reason?: string };
    const reason = body.reason?.trim();
    const order = ORDERS.find((item) => item.id === orderId);
    const isRisk =
      order?.status === 'DELIVERING' ||
      order?.status === 'HUB_ARRIVED' ||
      order?.status === 'PICKED_UP' ||
      order?.status === 'DELIVERED' ||
      order?.status === 'REVIEWED';

    if (isRisk && (!reason || reason.length < 5)) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: '배달 후 환불은 사유(5자 이상)가 필수입니다.' }),
      });
      return;
    }

    state.refundRequests.push({ orderId, reason });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: orderId, status: 'CANCELLED', cancelReason: reason }),
    });
  });

  return state;
}

async function openOrders(page: Page): Promise<OrdersMockState> {
  const state = await installOrdersApiFixture(page);
  await page.goto(`${BASE}/admin/orders`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('전체 주문')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('combobox', { name: '스토어' })).toBeVisible({ timeout: 15_000 });
  return state;
}

function rows(page: Page) {
  return page.locator('table tbody tr');
}

async function selectOption(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('Admin - 주문 목록 세션δ 회귀', () => {
  test.use({ storageState: ADMIN_STATE_PATH });
  test.skip(skipAuth, 'TEST_ADMIN_EMAIL/PASSWORD 미설정 - 어드민 인증 검증을 건너뜁니다');

  test('스토어 Select는 옵션을 로드하고 선택한 스토어 주문만 표시한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const state = await openOrders(page);

    await expect(rows(page)).toHaveCount(4);
    await selectOption(page, '스토어', '알파난원');
    await expect(rows(page)).toHaveCount(2);
    await expect(page.locator('table')).toContainText('ORD-PRE-001');
    await expect(page.locator('table')).not.toContainText('ORD-DEL-002');
    expect(state.readUrls.some((url) => url.includes('storeId=store-active-alpha'))).toBe(true);
  });

  test('치운 스토어 토글은 archived 옵션 노출을 제어한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openOrders(page);

    await page.getByRole('combobox', { name: '스토어' }).click();
    await expect(page.getByRole('option', { name: '감마치운농장 (치운)' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByLabel('치운 스토어 포함').check();
    await page.getByRole('combobox', { name: '스토어' }).click();
    await expect(page.getByRole('option', { name: '감마치운농장 (치운)' })).toBeVisible();
  });

  test('상태 Select는 선택한 상태 주문만 표시한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openOrders(page);

    await selectOption(page, '상태', '준비중');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('table')).toContainText('ORD-PRE-001');
    await expect(page.locator('table')).not.toContainText('ORD-DEL-002');
  });

  test('송장 정보가 있는 주문은 택배사와 운송장번호를 표시한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openOrders(page);

    const deliveringRow = rows(page).filter({ hasText: 'ORD-DEL-002' });
    await expect(deliveringRow).toContainText('CJ대한통운');
    await expect(deliveringRow).toContainText('123456789012');
  });

  test('상세 보기 모달은 목록 응답의 핵심 주문 정보를 표시한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openOrders(page);

    await page.getByRole('button', { name: 'ORD-PRE-001 상세 보기' }).click();

    const dialog = page.getByRole('dialog', { name: '주문 상세' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('ORD-PRE-001');
    await expect(dialog).toContainText('준비중');
    await expect(dialog).toContainText('호접란 3대');
    await expect(dialog).toContainText('2개');
    await expect(dialog).toContainText('김알파');
    await expect(dialog).toContainText('010-1111-2222');
    await expect(dialog).toContainText('서울시 강남구 테헤란로 1 101호 (06100)');
    await expect(dialog).toContainText('송장');
  });

  test('수동 새로고침은 현재 목록을 재조회한다', async ({ page }) => {
    const state = await openOrders(page);
    const beforeReload = state.readUrls.length;

    await page.getByRole('button', { name: '주문 목록 새로고침' }).click();

    await expect.poll(() => state.readUrls.length).toBeGreaterThan(beforeReload);
  });

  test('자동 새로고침은 30초 간격 등록 후 재조회한다', async ({ page }) => {
    await installFastInterval(page);
    const state = await openOrders(page);
    const beforeToggle = state.readUrls.length;

    await page.getByLabel('자동 새로고침(30초)').check();

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __adminOrdersIntervalDelays: number[] })
              .__adminOrdersIntervalDelays,
        ),
      )
      .toContain(30_000);
    await expect.poll(() => state.readUrls.length).toBeGreaterThan(beforeToggle);
  });

  test('일반 단계 환불 모달은 사유 없이 확인할 수 있다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const state = await openOrders(page);

    await rows(page)
      .filter({ hasText: 'ORD-PRE-001' })
      .getByRole('button', { name: '강제환불' })
      .click();
    await expect(page.getByRole('dialog', { name: '강제환불' })).toBeVisible();
    await expect(page.getByText('배달 진행 후 환불입니다.')).toHaveCount(0);
    await page.getByRole('button', { name: '환불 처리' }).click();

    await expect
      .poll(() => state.refundRequests)
      .toContainEqual({
        orderId: 'order-preparing-alpha',
        reason: undefined,
      });
  });

  test('위험 단계 환불 모달은 경고와 사유 길이 검증을 적용한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const state = await openOrders(page);

    await rows(page)
      .filter({ hasText: 'ORD-DEL-002' })
      .getByRole('button', { name: '강제환불' })
      .click();
    await expect(page.getByText('배달 진행 후 환불입니다. 정산·고객 영향이 큽니다.')).toBeVisible();
    await expect(page.getByRole('button', { name: '환불 처리' })).toBeDisabled();
    await page.getByLabel('환불 사유').fill('짧음');
    await expect(page.getByRole('button', { name: '환불 처리' })).toBeDisabled();
    await page.getByLabel('환불 사유').fill('고객 요청으로 환불');
    await page.getByRole('button', { name: '환불 처리' }).click();

    await expect
      .poll(() => state.refundRequests)
      .toContainEqual({
        orderId: 'order-delivering-beta',
        reason: '고객 요청으로 환불',
      });
  });

  test('위험 단계 사유 누락 직접 호출은 400으로 차단된다', async ({ page }) => {
    await openOrders(page);

    const response = await page.evaluate(async () => {
      const res = await fetch('/admin/orders/order-delivering-beta/refund', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      message: '배달 후 환불은 사유(5자 이상)가 필수입니다.',
    });
  });
});
