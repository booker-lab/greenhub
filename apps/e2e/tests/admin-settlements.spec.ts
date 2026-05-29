import { expect, type Page, test } from '@playwright/test';
import { ADMIN_STATE_PATH } from './_helpers/auth';

const BASE = process.env.SELLER_BASE ?? 'https://seller.greenlove.co.kr';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const adminEmail = process.env.TEST_ADMIN_EMAIL;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
const skipAuth = !adminEmail || !adminPassword;

type SettlementStatus = 'pending' | 'confirmed' | 'paid' | 'cancelled';

interface SettlementFixture {
  id: string;
  storeId: string;
  orderId: string;
  totalAmount: number;
  platformFee: number;
  netAmount: number;
  status: SettlementStatus;
  settledAt: string;
  paidAt: string | null;
}

const BASE_SETTLEMENTS: SettlementFixture[] = [
  {
    id: 'set-confirmed-alpha',
    storeId: 'store-alpha-001',
    orderId: 'order-alpha',
    totalAmount: 100_000,
    platformFee: 10_000,
    netAmount: 90_000,
    status: 'confirmed',
    settledAt: '2026-05-28T02:30:00.000Z',
    paidAt: null,
  },
  {
    id: 'set-confirmed-fail',
    storeId: 'store-beta-002',
    orderId: 'order-beta',
    totalAmount: 80_000,
    platformFee: 8_000,
    netAmount: 72_000,
    status: 'confirmed',
    settledAt: '2026-05-27T02:30:00.000Z',
    paidAt: null,
  },
  {
    id: 'set-paid-gamma',
    storeId: 'store-gamma-003',
    orderId: 'order-gamma',
    totalAmount: 50_000,
    platformFee: 5_000,
    netAmount: 45_000,
    status: 'paid',
    settledAt: '2026-05-26T02:30:00.000Z',
    paidAt: '2026-05-26T04:00:00.000Z',
  },
  {
    id: 'set-pending-delta',
    storeId: 'store-delta-004',
    orderId: 'order-delta',
    totalAmount: 40_000,
    platformFee: 4_000,
    netAmount: 36_000,
    status: 'pending',
    settledAt: '2026-05-25T02:30:00.000Z',
    paidAt: null,
  },
  {
    id: 'set-cancelled-epsilon',
    storeId: 'store-epsilon-005',
    orderId: 'order-epsilon',
    totalAmount: 30_000,
    platformFee: 3_000,
    netAmount: 27_000,
    status: 'cancelled',
    settledAt: '2026-05-24T02:30:00.000Z',
    paidAt: null,
  },
];

interface SettlementsMockState {
  readUrls: string[];
  bulkRequests: string[][];
  singlePayRequests: string[];
}

function cloneSettlements(): SettlementFixture[] {
  return BASE_SETTLEMENTS.map((settlement) => ({ ...settlement }));
}

function todayKST(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function mondayThisWeekKST(): string {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  const day = kstNow.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  return new Date(kstNow.getTime() - diff * DAY_MS).toISOString().slice(0, 10);
}

function filterSettlements(settlements: SettlementFixture[], requestUrl: string) {
  const url = new URL(requestUrl);
  const status = url.searchParams.get('status');
  const storeId = url.searchParams.get('storeId');
  return settlements.filter((settlement) => {
    if (status && settlement.status !== status) return false;
    if (storeId && !settlement.storeId.includes(storeId)) return false;
    return true;
  });
}

async function installSettlementsApiFixture(page: Page): Promise<SettlementsMockState> {
  const state: SettlementsMockState = { readUrls: [], bulkRequests: [], singlePayRequests: [] };
  const settlements = cloneSettlements();

  await page.route(/\/admin\/settlements(?:\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || !request.headers().authorization) {
      await route.continue();
      return;
    }

    state.readUrls.push(request.url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        settlements: filterSettlements(settlements, request.url()),
        total: settlements.length,
      }),
    });
  });

  await page.route('**/admin/settlements/bulk-pay', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    const body = request.postDataJSON() as { ids?: string[] };
    const ids = body.ids ?? [];
    state.bulkRequests.push(ids);

    const failed = ids
      .filter((id) => id === 'set-confirmed-fail')
      .map((id) => ({ id, reason: '검증용 실패 정산' }));
    const ok = ids.filter((id) => !failed.some((item) => item.id === id));

    for (const id of ok) {
      const settlement = settlements.find((item) => item.id === id);
      if (settlement) {
        settlement.status = 'paid';
        settlement.paidAt = '2026-05-29T03:00:00.000Z';
      }
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok, failed }),
    });
  });

  await page.route(/\/admin\/settlements\/[^/]+\/pay$/, async (route) => {
    const request = route.request();
    if (request.method() !== 'PATCH') {
      await route.continue();
      return;
    }

    const id = new URL(request.url()).pathname.split('/').at(-2) ?? '';
    state.singlePayRequests.push(id);
    const settlement = settlements.find((item) => item.id === id);
    if (settlement) {
      settlement.status = 'paid';
      settlement.paidAt = '2026-05-29T03:00:00.000Z';
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id, status: 'paid' }),
    });
  });

  return state;
}

async function openSettlements(page: Page): Promise<SettlementsMockState> {
  const state = await installSettlementsApiFixture(page);
  await page.goto(`${BASE}/admin/settlements`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('정산 목록')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByPlaceholder('스토어 ID 필터')).toBeVisible({ timeout: 15_000 });
  return state;
}

function rows(page: Page) {
  return page.locator('table tbody tr');
}

function firstRow(page: Page) {
  return rows(page).first();
}

test.describe('Admin - 정산 목록 N+6 회귀', () => {
  test.use({ storageState: ADMIN_STATE_PATH });
  test.skip(skipAuth, 'TEST_ADMIN_EMAIL/PASSWORD 미설정 - 어드민 인증 검증을 건너뜁니다');

  test('status 탭은 전체·상태별 목록을 재조회하고 표시를 전환한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const state = await openSettlements(page);

    await expect(rows(page)).toHaveCount(5);
    await page.getByRole('button', { name: '확정', exact: true }).click();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.locator('table')).toContainText('store-al');
    await expect(page.locator('table')).not.toContainText('store-ga');

    await page.getByRole('button', { name: '지급 완료', exact: true }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('table')).toContainText('store-ga');

    await page.getByRole('button', { name: '전체', exact: true }).click();
    await expect(rows(page)).toHaveCount(5);
    expect(state.readUrls.some((url) => url.includes('status=confirmed'))).toBe(true);
    expect(state.readUrls.some((url) => url.includes('status=paid'))).toBe(true);
  });

  test('일괄 지급은 confirmed만 선택하고 성공 건을 paid로 반영한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const state = await openSettlements(page);

    await page.getByRole('button', { name: '확정', exact: true }).click();
    await page.getByLabel('지급 가능한 정산 전체 선택').check();
    await expect(page.getByText('선택 2건 · 지급 합계 162,000원')).toBeVisible();

    await page.getByRole('button', { name: '일괄 지급' }).click();
    await expect(page.getByText('선택한 2건을 지급 완료 처리할까요?')).toBeVisible();
    await page.getByRole('button', { name: '일괄 지급' }).last().click();

    await expect(page.getByText(/일괄 지급 부분 완료/)).toBeVisible();
    await expect(page.getByText('선택 1건 · 지급 합계 72,000원')).toBeVisible();
    await expect
      .poll(() => state.bulkRequests)
      .toContainEqual(['set-confirmed-alpha', 'set-confirmed-fail']);
  });

  test('부분 실패 후 실패 건만 다시 선택 상태로 남는다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openSettlements(page);

    await page.getByRole('button', { name: '확정', exact: true }).click();
    await page.getByLabel('지급 가능한 정산 전체 선택').check();
    await page.getByRole('button', { name: '일괄 지급' }).click();
    await page.getByRole('button', { name: '일괄 지급' }).last().click();

    await expect(page.getByText('검증용 실패 정산')).toBeVisible();
    await expect(page.locator('table')).not.toContainText('store-al');
    await expect(firstRow(page).getByLabel('store-be 정산 선택')).toBeChecked();
  });

  test('새로고침과 단건 지급은 기존 흐름을 유지한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const state = await openSettlements(page);
    const beforeReload = state.readUrls.length;

    await page.getByRole('button', { name: '정산 목록 새로고침' }).click();
    await expect.poll(() => state.readUrls.length).toBeGreaterThan(beforeReload);

    await page.getByRole('button', { name: '확정', exact: true }).click();
    await firstRow(page).getByRole('button', { name: '지급처리' }).click();
    await expect(page.getByText('이 정산을 지급 완료 처리하시겠습니까?')).toBeVisible();
    await page.getByRole('button', { name: '지급 완료' }).last().click();
    await expect.poll(() => state.singlePayRequests).toContainEqual('set-confirmed-alpha');
  });

  test('빠른 기간 버튼은 KST 기준 from/to 쿼리를 적용한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const state = await openSettlements(page);

    await page.getByRole('button', { name: '이번 주' }).click();

    await expect
      .poll(() => state.readUrls.some((url) => url.includes(`from=${mondayThisWeekKST()}`)))
      .toBe(true);
    expect(state.readUrls.some((url) => url.includes(`to=${todayKST()}`))).toBe(true);
  });
});
