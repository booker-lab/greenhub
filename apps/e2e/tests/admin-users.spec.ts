import { expect, type Page, test } from '@playwright/test';
import { ADMIN_STATE_PATH } from './_helpers/auth';

const BASE = process.env.SELLER_BASE ?? 'https://seller.greenlove.co.kr';

const adminEmail = process.env.TEST_ADMIN_EMAIL;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
const skipAuth = !adminEmail || !adminPassword;

const USERS_FIXTURE = [
  {
    id: 'e2e-user-minsu',
    email: 'minsu@example.com',
    name: '김민수',
    phone: '010-1234-5678',
    role: 'consumer',
    suspended: false,
    createdAt: '2026-05-27T03:00:00.000Z',
  },
  {
    id: 'e2e-user-sora',
    email: 'sora@example.com',
    name: '이소라',
    phone: '01099998888',
    role: 'consumer',
    suspended: true,
    createdAt: '2026-05-26T03:00:00.000Z',
  },
  {
    id: 'e2e-user-empty-phone',
    email: 'no-phone@example.com',
    name: '전화없음',
    phone: '',
    role: 'consumer',
    suspended: false,
    createdAt: '2026-05-25T03:00:00.000Z',
  },
];

interface UsersMockState {
  readCount: number;
  statusUpdates: Array<{ userId: string; suspended: boolean }>;
}

async function installUsersApiFixture(page: Page): Promise<UsersMockState> {
  const state: UsersMockState = { readCount: 0, statusUpdates: [] };

  await page.route('**/admin/users', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || !request.headers().authorization) {
      await route.continue();
      return;
    }
    state.readCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ users: USERS_FIXTURE, total: USERS_FIXTURE.length }),
    });
  });

  await page.route('**/admin/users/*/status', async (route) => {
    const request = route.request();
    if (request.method() !== 'PATCH') {
      await route.continue();
      return;
    }
    const userId = new URL(request.url()).pathname.split('/').at(-2) ?? '';
    const body = request.postDataJSON() as { suspended?: boolean };
    state.statusUpdates.push({ userId, suspended: body.suspended === true });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ userId, suspended: body.suspended === true }),
    });
  });

  return state;
}

async function openUsers(page: Page): Promise<UsersMockState> {
  const state = await installUsersApiFixture(page);
  await page.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('소비자 계정')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('소비자 검색')).toBeVisible({ timeout: 15_000 });
  return state;
}

function desktopRows(page: Page) {
  return page.locator('table tbody tr');
}

test.describe('Admin - 소비자 목록 S5 회귀', () => {
  test.use({ storageState: ADMIN_STATE_PATH });
  test.skip(skipAuth, 'TEST_ADMIN_EMAIL/PASSWORD 미설정 - 어드민 인증 검증을 건너뜁니다');

  test('가입일과 전화가 데스크톱 테이블에 표시된다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openUsers(page);

    await expect(page.getByRole('columnheader', { name: '가입일' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '전화' })).toBeVisible();
    await expect(desktopRows(page)).toHaveCount(3);
    await expect(page.locator('table')).toContainText('2026-05-27');
    await expect(page.locator('table')).toContainText('010-1234-5678');
    await expect(page.locator('table')).toContainText('no-phone@example.com');
  });

  test('가입일과 전화가 모바일 카드에 표시된다', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await openUsers(page);

    await expect(page.getByText('가입일 2026-05-27')).toBeVisible();
    await expect(page.getByText('전화 010-1234-5678')).toBeVisible();
    await expect(page.getByText('전화 -')).toBeVisible();
  });

  test('새로고침 버튼은 소비자 목록을 재조회한다', async ({ page }) => {
    const state = await openUsers(page);
    const beforeReload = state.readCount;

    await page.getByRole('button', { name: '소비자 계정 새로고침' }).click();

    await expect.poll(() => state.readCount).toBeGreaterThan(beforeReload);
  });

  test('상태 탭은 전체·정상·정지를 즉시 필터링한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openUsers(page);

    await expect(desktopRows(page)).toHaveCount(3);

    await page.getByRole('button', { name: '정상', exact: true }).click();
    await expect(desktopRows(page)).toHaveCount(2);
    await expect(page.locator('table')).toContainText('김민수');
    await expect(page.locator('table')).not.toContainText('이소라');

    await page.getByRole('button', { name: '정지', exact: true }).first().click();
    await expect(desktopRows(page)).toHaveCount(1);
    await expect(page.locator('table')).toContainText('이소라');

    await page.getByRole('button', { name: '전체', exact: true }).click();
    await expect(desktopRows(page)).toHaveCount(3);
  });

  test('검색은 이름·이메일·전화번호를 부분 일치로 찾는다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openUsers(page);

    const search = page.getByLabel('소비자 검색');
    await search.fill('소라');
    await expect(desktopRows(page)).toHaveCount(1);
    await expect(page.locator('table')).toContainText('sora@example.com');

    await search.fill('NO-PHONE');
    await expect(desktopRows(page)).toHaveCount(1);
    await expect(page.locator('table')).toContainText('전화없음');

    await search.fill('010-1234-5678');
    await expect(desktopRows(page)).toHaveCount(1);
    await expect(page.locator('table')).toContainText('김민수');
  });

  test('검색 결과가 없으면 전용 빈결과 문구를 표시하고 필터는 유지된다', async ({ page }) => {
    await openUsers(page);

    await page.getByLabel('소비자 검색').fill('없는소비자xyz');

    await expect(page.getByText('검색 결과가 없습니다.')).toBeVisible();
    await expect(page.getByLabel('소비자 검색')).toBeVisible();
    await expect(page.getByRole('button', { name: '전체', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '정상', exact: true })).toBeVisible();
  });

  test('검색·필터 적용 상태에서도 정지 확인창과 요청 본문이 유지된다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const state = await openUsers(page);

    await page.getByLabel('소비자 검색').fill('민수');
    await page.getByRole('button', { name: '정상', exact: true }).click();
    await desktopRows(page).first().getByRole('button', { name: '정지', exact: true }).click();

    await expect(page.getByText('소비자 계정을 정지할까요?')).toBeVisible();
    await page.getByRole('button', { name: '정지하기' }).click();

    await expect.poll(() => state.statusUpdates).toContainEqual({
      userId: 'e2e-user-minsu',
      suspended: true,
    });
  });
});
