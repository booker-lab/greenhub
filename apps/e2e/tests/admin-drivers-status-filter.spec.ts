import { expect, type Page, test } from '@playwright/test';
import { ADMIN_STATE_PATH } from './_helpers/auth';

const BASE = process.env.SELLER_BASE ?? 'https://seller.greenlove.co.kr';

const adminEmail = process.env.TEST_ADMIN_EMAIL;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
const skipAuth = !adminEmail || !adminPassword;

const DRIVERS_FIXTURE = [
  {
    id: 'e2e-driver-pending',
    name: '대기 드라이버',
    email: 'pending-driver@example.com',
    driverApproved: false,
    suspended: false,
    createdAt: '2026-05-29T01:00:00.000Z',
  },
  {
    id: 'e2e-driver-approved',
    name: '승인 드라이버',
    email: 'approved-driver@example.com',
    driverApproved: true,
    suspended: false,
    createdAt: '2026-05-29T02:00:00.000Z',
  },
  {
    id: 'e2e-driver-suspended',
    name: '정지 드라이버',
    email: 'suspended-driver@example.com',
    driverApproved: true,
    suspended: true,
    createdAt: '2026-05-29T03:00:00.000Z',
  },
];

interface DriversRequest {
  pathname: string;
  status: string | null;
}

interface DriversMockState {
  requests: DriversRequest[];
}

function filterDrivers(status: string | null) {
  if (status === 'pending') {
    return DRIVERS_FIXTURE.filter((driver) => !driver.driverApproved && !driver.suspended);
  }
  if (status === 'approved') {
    return DRIVERS_FIXTURE.filter((driver) => driver.driverApproved && !driver.suspended);
  }
  if (status === 'suspended') {
    return DRIVERS_FIXTURE.filter((driver) => driver.suspended);
  }
  return DRIVERS_FIXTURE;
}

async function installDriversApiFixture(page: Page): Promise<DriversMockState> {
  const state: DriversMockState = { requests: [] };

  await page.route('**/admin/drivers**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || !request.headers().authorization) {
      await route.continue();
      return;
    }

    const url = new URL(request.url());
    const status = url.searchParams.get('status');
    const drivers = filterDrivers(status);
    state.requests.push({ pathname: url.pathname, status });

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ drivers, total: drivers.length }),
    });
  });

  return state;
}

async function openDrivers(page: Page): Promise<DriversMockState> {
  const state = await installDriversApiFixture(page);
  await page.goto(`${BASE}/admin/drivers`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('드라이버 관리')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('대기 드라이버')).toBeVisible({ timeout: 15_000 });
  return state;
}

function expectLatestRequest(state: DriversMockState, status: string | null) {
  return expect
    .poll(() => state.requests.at(-1))
    .toEqual({
      pathname: '/admin/drivers',
      status,
    });
}

async function expectVisibleDrivers(page: Page, names: string[]) {
  for (const driver of DRIVERS_FIXTURE) {
    const assertion = expect(page.getByText(driver.name));
    if (names.includes(driver.name)) {
      await assertion.toBeVisible();
    } else {
      await assertion.toHaveCount(0);
    }
  }
}

test.describe('Admin - 드라이버 status 서버 필터 회귀', () => {
  test.use({ storageState: ADMIN_STATE_PATH });
  test.skip(skipAuth, 'TEST_ADMIN_EMAIL/PASSWORD 미설정 - 어드민 인증 검증을 건너뜁니다');

  test('승인 대기 기본 탭은 pending 요청과 응답 명단만 표시한다', async ({ page }) => {
    const state = await openDrivers(page);

    await expectLatestRequest(state, 'pending');
    await expectVisibleDrivers(page, ['대기 드라이버']);
    await expect(page.getByRole('button', { name: '승인 대기', exact: true })).toBeVisible();
  });

  test('승인 완료 탭은 approved 요청과 응답 명단만 표시한다', async ({ page }) => {
    const state = await openDrivers(page);

    await page.getByRole('button', { name: '승인 완료', exact: true }).click();

    await expectLatestRequest(state, 'approved');
    await expectVisibleDrivers(page, ['승인 드라이버']);
    await expect(page.getByRole('button', { name: '승인 완료', exact: true })).toBeVisible();
  });

  test('정지됨 탭은 suspended 요청과 응답 명단만 표시한다', async ({ page }) => {
    const state = await openDrivers(page);

    await page.getByRole('button', { name: '정지됨', exact: true }).click();

    await expectLatestRequest(state, 'suspended');
    await expectVisibleDrivers(page, ['정지 드라이버']);
    await expect(page.getByText('정지 해제')).toBeVisible();
  });

  test('전체 탭은 status 쿼리 없이 정지 포함 전체 명단을 표시한다', async ({ page }) => {
    const state = await openDrivers(page);

    await page.getByRole('button', { name: '전체', exact: true }).click();

    await expectLatestRequest(state, null);
    await expectVisibleDrivers(page, ['대기 드라이버', '승인 드라이버', '정지 드라이버']);
  });

  test('검색과 새로고침은 현재 status 탭을 유지한다', async ({ page }) => {
    const state = await openDrivers(page);

    await page.getByLabel('드라이버 검색').fill('approved');

    await expect(page.getByText('검색 결과가 없습니다.')).toBeVisible();
    await expectVisibleDrivers(page, []);

    await page.getByLabel('드라이버 검색').fill('pending-driver');

    await expectVisibleDrivers(page, ['대기 드라이버']);

    const requestCount = state.requests.length;
    await page.getByLabel('드라이버 목록 새로고침').click();

    await expect.poll(() => state.requests.length).toBeGreaterThan(requestCount);
    await expectLatestRequest(state, 'pending');
    await expect(page.getByLabel('드라이버 검색')).toHaveValue('pending-driver');
  });
});
