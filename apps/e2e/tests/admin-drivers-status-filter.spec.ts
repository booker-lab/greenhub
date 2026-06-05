import { expect, type Locator, type Page, test } from '@playwright/test';
import { ADMIN_STATE_PATH } from './_helpers/auth';
import { expectNoHorizontalOverflow, setMobileViewport } from './_helpers/responsive';

const BASE = process.env.SELLER_BASE ?? 'https://seller.greenlove.co.kr';

const adminEmail = process.env.TEST_ADMIN_EMAIL;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
const skipAuth = !adminEmail || !adminPassword;

const DRIVERS_FIXTURE = [
  {
    id: 'e2e-driver-pending',
    name: '대기 드라이버',
    email: 'pending-driver@example.com',
    phone: '010-1000-0001',
    vehicleType: '냉장 탑차',
    vehicleNumber: '서울12가3456',
    driverApproved: false,
    suspended: false,
    createdAt: '2026-05-29T01:00:00.000Z',
  },
  {
    id: 'e2e-driver-approved',
    name: '승인 드라이버',
    email: 'approved-driver@example.com',
    phone: '010-1000-0002',
    vehicleType: null,
    vehicleNumber: null,
    driverApproved: true,
    suspended: false,
    createdAt: '2026-05-29T02:00:00.000Z',
  },
  {
    id: 'e2e-driver-suspended',
    name: '정지 드라이버',
    email: 'suspended-driver@example.com',
    phone: '010-1000-0003',
    vehicleType: '승용차',
    vehicleNumber: null,
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
  approvedIds: Set<string>;
  delayedSuspendIds: Set<string>;
  failedSuspendIds: Set<string>;
  suspendedById: Map<string, boolean>;
}

function currentDrivers(state: DriversMockState) {
  return DRIVERS_FIXTURE.map((driver) => ({
    ...driver,
    driverApproved: state.approvedIds.has(driver.id) || driver.driverApproved,
    suspended: state.suspendedById.get(driver.id) ?? driver.suspended,
  }));
}

function filterDrivers(state: DriversMockState, status: string | null) {
  const drivers = currentDrivers(state);
  if (status === 'pending') {
    return drivers.filter((driver) => !driver.driverApproved && !driver.suspended);
  }
  if (status === 'approved') {
    return drivers.filter((driver) => driver.driverApproved && !driver.suspended);
  }
  if (status === 'suspended') return drivers.filter((driver) => driver.suspended);
  return drivers;
}

async function installDriversApiFixture(page: Page): Promise<DriversMockState> {
  const state: DriversMockState = {
    requests: [],
    approvedIds: new Set(),
    delayedSuspendIds: new Set(),
    failedSuspendIds: new Set(),
    suspendedById: new Map(),
  };

  await page.route('**/admin/drivers**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const approveMatch = url.pathname.match(/^\/admin\/drivers\/([^/]+)\/approve$/);
    const suspendMatch = url.pathname.match(/^\/admin\/drivers\/([^/]+)\/suspend$/);

    if (request.method() === 'PATCH' && approveMatch) {
      state.approvedIds.add(approveMatch[1]);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (request.method() === 'PATCH' && suspendMatch) {
      const userId = suspendMatch[1];
      if (state.failedSuspendIds.has(userId)) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: '의도한 드라이버 상태 변경 실패' }),
        });
        return;
      }

      if (state.delayedSuspendIds.has(userId)) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const body = request.postDataJSON() as { suspended: boolean };
      state.suspendedById.set(userId, body.suspended);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (request.method() !== 'GET' || !request.headers().authorization) {
      await route.continue();
      return;
    }

    const status = url.searchParams.get('status');
    const drivers = filterDrivers(state, status);
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

async function expectTabsStayOnOneLine(page: Page) {
  const buttons = page
    .getByRole('button')
    .filter({ hasText: /^(전체|승인 대기|승인 완료|정지됨)$/ });
  await expect(buttons).toHaveCount(4);

  const topPositions = await buttons.evaluateAll((elements) =>
    elements.map((element) => Math.round(element.getBoundingClientRect().top)),
  );
  expect(new Set(topPositions).size).toBe(1);
}

async function expectButtonStyle(button: Locator, variant: 'filled' | 'light', color: string) {
  const expectedBackground = {
    'green-filled': 'rgb(64, 192, 87)',
    'red-filled': 'rgb(250, 82, 82)',
    'red-light': 'rgb(255, 227, 227)',
    'gray-filled': 'rgb(134, 142, 150)',
    'gray-light': 'rgb(241, 243, 245)',
  }[`${color}-${variant}`];

  if (variant === 'light') {
    await expect(button).toHaveAttribute('data-variant', variant);
  } else {
    await expect(button).not.toHaveAttribute('data-variant', /.+/);
  }
  await expect
    .poll(() => button.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe(expectedBackground);
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

    await page.getByLabel('드라이버 검색').fill('010-1000-0001');
    await expectVisibleDrivers(page, ['대기 드라이버']);

    const requestCount = state.requests.length;
    await page.getByLabel('드라이버 목록 새로고침').click();

    await expect.poll(() => state.requests.length).toBeGreaterThan(requestCount);
    await expectLatestRequest(state, 'pending');
    await expect(page.getByLabel('드라이버 검색')).toHaveValue('010-1000-0001');
  });

  test('승인 성공 후 확인 위치 알림을 표시한다', async ({ page }) => {
    const state = await openDrivers(page);

    await page.getByRole('button', { name: '승인', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '승인', exact: true }).click();

    await expect(
      page.getByText('드라이버를 승인했습니다. 승인 완료 탭에서 확인할 수 있습니다.'),
    ).toBeVisible();
    await expect(page.getByText('대기 드라이버')).toHaveCount(0);

    await page.getByRole('button', { name: '승인 완료', exact: true }).click();
    await expectLatestRequest(state, 'approved');
    await expect(page.getByText('대기 드라이버')).toBeVisible();
  });

  test('정지와 정지 해제 성공 후 확인 위치 알림을 표시한다', async ({ page }) => {
    const state = await openDrivers(page);

    await page.getByRole('button', { name: '승인 완료', exact: true }).click();
    await expectLatestRequest(state, 'approved');
    await page.getByRole('button', { name: '정지', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '정지', exact: true }).click();
    await expect(
      page.getByText('드라이버를 정지했습니다. 정지됨 탭에서 확인할 수 있습니다.'),
    ).toBeVisible();
    await expect(page.getByText('승인 드라이버')).toHaveCount(0);

    await page.getByRole('button', { name: '정지됨', exact: true }).click();
    await expectLatestRequest(state, 'suspended');
    await page.getByRole('button', { name: '정지 해제', exact: true }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: '해제', exact: true }).click();
    await expect(
      page.getByText('드라이버 정지를 해제했습니다. 승인 완료 탭에서 확인할 수 있습니다.'),
    ).toBeVisible();
    await expect(page.getByText('승인 드라이버')).toHaveCount(0);

    await page.getByRole('button', { name: '승인 완료', exact: true }).click();
    await expectLatestRequest(state, 'approved');
    await expect(page.getByText('승인 드라이버')).toBeVisible();
  });

  test('상태 변경 처리 중 카드 라벨을 바꾸고 중복 클릭을 막는다', async ({ page }) => {
    const state = await openDrivers(page);
    state.delayedSuspendIds.add('e2e-driver-pending');

    await page.getByRole('button', { name: '정지', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '정지', exact: true }).click();

    const processingButtons = page.getByRole('button', { name: '처리중…', exact: true });
    await expect(processingButtons).toHaveCount(2);
    await expect(processingButtons.first()).toBeDisabled();
    await expect(processingButtons.last()).toBeDisabled();
    await expect(
      page.getByText('드라이버를 정지했습니다. 정지됨 탭에서 확인할 수 있습니다.'),
    ).toBeVisible();
  });

  test('상태별 액션 버튼 스타일과 확인창 계약을 유지한다', async ({ page }) => {
    const state = await openDrivers(page);

    const approveButton = page.getByRole('button', { name: '승인', exact: true });
    const suspendButton = page.getByRole('button', { name: '정지', exact: true });
    await expectButtonStyle(approveButton, 'filled', 'green');
    await expectButtonStyle(suspendButton, 'light', 'red');

    await approveButton.click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByText('드라이버 승인')).toBeVisible();
    await expect(dialog.getByText('이 드라이버를 승인하시겠습니까?')).toBeVisible();
    await expectButtonStyle(
      dialog.getByRole('button', { name: '승인', exact: true }),
      'filled',
      'green',
    );
    await dialog.getByRole('button', { name: '취소', exact: true }).click();

    await suspendButton.click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByText('드라이버 정지')).toBeVisible();
    await expect(dialog.getByText('이 드라이버를 정지하시겠습니까?')).toBeVisible();
    await expectButtonStyle(
      dialog.getByRole('button', { name: '정지', exact: true }),
      'filled',
      'red',
    );
    await dialog.getByRole('button', { name: '취소', exact: true }).click();

    await page.getByRole('button', { name: '정지됨', exact: true }).click();
    await expectLatestRequest(state, 'suspended');
    const unsuspendButton = page.getByRole('button', { name: '정지 해제', exact: true });
    await expectButtonStyle(unsuspendButton, 'light', 'gray');

    await unsuspendButton.click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByText('드라이버 정지 해제')).toBeVisible();
    await expect(dialog.getByText('정지를 해제하시겠습니까?')).toBeVisible();
    await expectButtonStyle(
      dialog.getByRole('button', { name: '해제', exact: true }),
      'filled',
      'gray',
    );
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
  });

  test('상태 변경 실패 시 알림을 표시하고 확인창을 유지한다', async ({ page }) => {
    const state = await openDrivers(page);
    state.failedSuspendIds.add('e2e-driver-pending');

    await page.getByRole('button', { name: '정지', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '정지', exact: true }).click();

    await expect(
      page.getByText('드라이버 상태 변경에 실패했습니다. 잠시 후 다시 시도해주세요.'),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test('모바일 — 탭, 카드 정보, 상태별 액션이 폭 안에 수납된다', async ({ page }) => {
    await setMobileViewport(page);
    const state = await openDrivers(page);

    await expectTabsStayOnOneLine(page);
    await expect(page.getByLabel('드라이버 목록 새로고침')).toBeVisible();
    await expect(page.getByLabel('드라이버 검색')).toBeVisible();
    await expect(page.getByText('pending-driver@example.com')).toBeVisible();
    await expect(page.getByText('연락처 010-1000-0001')).toBeVisible();
    await expect(page.getByText('차량 냉장 탑차 · 서울12가3456')).toBeVisible();
    await expect(page.getByText('가입일 2026-05-29')).toBeVisible();
    await expect(page.getByRole('button', { name: '승인', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '정지', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: '승인 완료', exact: true }).click();
    await expectLatestRequest(state, 'approved');
    await expect(page.getByText('승인 드라이버')).toBeVisible();
    await expect(page.getByText('연락처 010-1000-0002')).toBeVisible();
    await expect(page.getByText('차량 정보 미등록')).toBeVisible();
    await expect(page.getByRole('button', { name: '정지', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '정지됨', exact: true }).click();
    await expectLatestRequest(state, 'suspended');
    await expect(page.getByText('정지 드라이버')).toBeVisible();
    await expect(page.getByText('차량 승용차')).toBeVisible();
    await expect(page.getByRole('button', { name: '정지 해제', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('모바일 — 승인 확인창과 성공 알림이 폭 안에 수납된다', async ({ page }) => {
    await setMobileViewport(page);
    await openDrivers(page);

    await page.getByRole('button', { name: '승인', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await dialog.getByRole('button', { name: '승인', exact: true }).click();
    const notification = page.getByText(
      '드라이버를 승인했습니다. 승인 완료 탭에서 확인할 수 있습니다.',
    );
    await expect(notification).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
