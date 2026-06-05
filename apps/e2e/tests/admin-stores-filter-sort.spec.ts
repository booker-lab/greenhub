import { expect, type Page, test } from '@playwright/test';
import { ADMIN_STATE_PATH } from './_helpers/auth';
import {
  expectAdminTableSwitchAtSm,
  expectNoHorizontalOverflow,
  setMobileViewport,
} from './_helpers/responsive';

const BASE = process.env.SELLER_BASE ?? 'https://seller.greenlove.co.kr';

const adminEmail = process.env.TEST_ADMIN_EMAIL;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
const skipAuth = !adminEmail || !adminPassword;

const STORES_FIXTURE = [
  {
    id: 'e2e-store-active-dear',
    name: '디어 플라워',
    ownerId: 'e2e-owner-active',
    status: 'active',
    commissionRate: 0.05,
    createdAt: null,
  },
  {
    id: 'e2e-store-invited',
    name: '초대 농원',
    ownerId: 'e2e-owner-invited',
    status: 'invited',
    commissionRate: 0.1,
    createdAt: null,
  },
  {
    id: 'e2e-store-archived',
    name: '정리된 정원',
    ownerId: 'e2e-owner-archived',
    status: 'archived',
    commissionRate: 0.2,
    createdAt: null,
  },
];

interface StoresMockState {
  readCount: number;
  commissionRates: number[];
}

async function installStoresApiFixture(page: Page): Promise<StoresMockState> {
  const state: StoresMockState = { readCount: 0, commissionRates: [] };

  await page.route('**/admin/stores', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || !request.headers().authorization) {
      await route.continue();
      return;
    }
    state.readCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ stores: STORES_FIXTURE, total: STORES_FIXTURE.length }),
    });
  });

  await page.route('**/admin/stores/*/commission', async (route) => {
    const request = route.request();
    if (request.method() !== 'PATCH') {
      await route.continue();
      return;
    }
    const body = request.postDataJSON() as { rate?: number };
    if (typeof body.rate === 'number') state.commissionRates.push(body.rate);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ commissionRate: body.rate }),
    });
  });

  return state;
}

async function openStores(page: Page, query = ''): Promise<StoresMockState> {
  const state = await installStoresApiFixture(page);
  await page.goto(`${BASE}/admin/stores${query}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('판매자 목록')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('디어 플라워')).toHaveCount(2, { timeout: 15_000 });
  return state;
}

function statusSelect(page: Page) {
  return page.getByRole('combobox', { name: '상태', exact: true });
}

function mobileSortSelect(page: Page) {
  return page.getByRole('combobox', { name: '정렬', exact: true });
}

test.describe('Admin - 판매자 검색·필터·정렬·수수료 회귀', () => {
  test.use({ storageState: ADMIN_STATE_PATH });
  test.skip(skipAuth, 'TEST_ADMIN_EMAIL/PASSWORD 미설정 - 어드민 인증 검증을 건너뜁니다');

  test('기본 진입은 활성 판매자만 표시한다', async ({ page }) => {
    await openStores(page);

    await expect(statusSelect(page)).toHaveValue('활성');
    await expect(page.getByText('디어 플라워')).toHaveCount(2);
    await expect(page.getByText('초대 농원')).toHaveCount(2);
    await expect(page.getByText('정리된 정원')).toHaveCount(0);
  });

  test('모바일 카드는 수수료 액션과 편집 입력을 폭 안에 표시한다', async ({ page }) => {
    await setMobileViewport(page);
    await openStores(page);

    await expect(page.locator('table')).not.toBeVisible();
    await expect(mobileSortSelect(page)).toBeVisible();
    await expect(page.getByText('디어 플라워').first()).toBeVisible();
    await expect(page.getByText('e2e-stor…').first()).toBeVisible();
    await expect(page.getByText('5.0%').first()).toBeVisible();
    await expect(
      page.locator('.mantine-Badge-root').filter({ hasText: '운영중' }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '수수료 설정' })).toHaveCount(2);

    await page.getByRole('button', { name: '수수료 설정' }).first().click();
    const input = page.getByPlaceholder('0.05').first();
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('inputmode', 'decimal');
    await expect(page.locator('.mantine-NumberInput-control')).toHaveCount(4);
    await expect(page.getByRole('button', { name: '저장' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '취소' }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('sm 경계에서 카드와 테이블 표시를 전환한다', async ({ page }) => {
    await openStores(page);
    await expectAdminTableSwitchAtSm(page);
  });

  test('검색어 입력은 일치 판매자만 남긴다', async ({ page }) => {
    await openStores(page);

    await page.getByLabel('판매자 검색').fill('디어');

    await expect(page.getByText('디어 플라워')).toHaveCount(2);
    await expect(page.getByText('초대 농원')).toHaveCount(0);
  });

  test('정리됨 필터는 archived 판매자와 URL을 복원한다', async ({ page }) => {
    await openStores(page);

    await statusSelect(page).click();
    await page.getByRole('option', { name: '정리됨', exact: true }).click();

    await expect(page).toHaveURL(/status=archived/);
    await expect(page.getByText('정리된 정원')).toHaveCount(2);
    await expect(page.getByText('디어 플라워')).toHaveCount(0);
  });

  test('전체 필터의 새로고침은 판매자 목록을 재조회한다', async ({ page }) => {
    const state = await openStores(page);

    await statusSelect(page).click();
    await page.getByRole('option', { name: '전체', exact: true }).click();
    await expect(page.getByText('정리된 정원')).toHaveCount(2);
    const beforeReload = state.readCount;

    await page.getByRole('button', { name: '새로고침' }).click();

    await expect.poll(() => state.readCount).toBeGreaterThan(beforeReload);
  });

  test('수수료율 정렬 제어는 오름차순과 내림차순 URL을 전환한다', async ({ page }, testInfo) => {
    await openStores(page);

    if (testInfo.project.name === 'mobile') {
      await mobileSortSelect(page).click();
      await page.getByRole('option', { name: '수수료율 ↑', exact: true }).click();
    } else {
      await page.getByRole('button', { name: '수수료율 오름차순 정렬' }).click();
    }
    await expect.poll(() => new URL(page.url()).searchParams.get('sort')).toBe('rate');
    await expect.poll(() => new URL(page.url()).searchParams.get('dir')).toBeNull();

    if (testInfo.project.name === 'mobile') {
      await mobileSortSelect(page).click();
      await page.getByRole('option', { name: '수수료율 ↓', exact: true }).click();
    } else {
      await page.getByRole('button', { name: '수수료율 내림차순 정렬' }).click();
    }
    await expect.poll(() => new URL(page.url()).searchParams.get('dir')).toBe('desc');
  });

  test('검색 결과가 없으면 필터 초기화로 기본 목록을 복원한다', async ({ page }) => {
    await openStores(page);

    await page.getByLabel('판매자 검색').fill('존재하지않는브랜드xyz');
    await expect(page.getByText('조건에 맞는 판매자가 없습니다.')).toBeVisible();
    await page.getByRole('button', { name: '필터 초기화' }).click();

    await expect(page.getByLabel('판매자 검색')).toHaveValue('');
    await expect(statusSelect(page)).toHaveValue('활성');
    await expect(page.getByText('디어 플라워')).toHaveCount(2);
  });

  test('직접 입력한 URL은 검색어와 운영중 상태를 복원한다', async ({ page }) => {
    await openStores(page, '?keyword=%EB%94%94%EC%96%B4&status=active');

    await expect(page.getByLabel('판매자 검색')).toHaveValue('디어');
    await expect(statusSelect(page)).toHaveValue('운영중');
    await expect(page.getByText('디어 플라워')).toHaveCount(2);
    await expect(page.getByText('초대 농원')).toHaveCount(0);
  });

  test('범위 밖 수수료는 저장 요청 본문으로 전달하지 않는다', async ({ page }) => {
    const state = await openStores(page);

    await page.getByRole('button', { name: '수수료 설정' }).first().click({ force: true });
    const input = page.getByPlaceholder('0.05').first();
    await input.fill('1.5', { force: true });
    await expect(input).not.toHaveValue('1.5');
    await page.getByRole('button', { name: '저장' }).first().click({ force: true });

    await expect.poll(() => state.commissionRates.includes(1.5)).toBe(false);
  });

  test('정상 수수료 저장은 요청 본문과 표시값을 유지한다', async ({ page }) => {
    const state = await openStores(page);

    await page.getByRole('button', { name: '수수료 설정' }).first().click({ force: true });
    await page.getByPlaceholder('0.05').first().fill('0.05', { force: true });
    await page.getByRole('button', { name: '저장' }).first().click({ force: true });

    await expect.poll(() => state.commissionRates).toContainEqual(0.05);
    await expect(page.locator('p:visible', { hasText: '5.0%' }).first()).toBeVisible();
  });
});
