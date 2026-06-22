import { expect, type Page, test } from '@playwright/test';

const BASE = process.env.CONSUMER_BASE ?? 'https://greenlove.co.kr';

const GROUP_PRODUCTS = [
  {
    id: 'group-recruiting',
    storeId: 'store-fixture',
    name: '모집 중 공구 상품',
    price: 32000,
    images: ['/icons/icon-192x192.png'],
    category: 'orchid',
    colors: ['레드'],
    saleType: 'group',
    isActive: true,
    groupSummary: {
      currentQuantity: 8,
      minQuantity: 10,
      targetQuantity: 30,
      recruitDeadline: '2099-12-31T00:00:00.000Z',
    },
  },
  {
    id: 'group-completed',
    storeId: 'store-fixture',
    name: '모집 완료 공구 상품',
    price: 42000,
    images: ['/icons/icon-192x192.png'],
    category: 'orchid',
    colors: ['화이트'],
    saleType: 'group',
    isActive: true,
    groupSummary: {
      currentQuantity: 30,
      minQuantity: 10,
      targetQuantity: 30,
      recruitDeadline: '2099-12-31T00:00:00.000Z',
    },
  },
  {
    id: 'group-needs-check',
    storeId: 'store-fixture',
    name: '정보 확인 공구 상품',
    price: 22000,
    images: ['/icons/icon-192x192.png'],
    category: 'orchid',
    colors: ['핑크'],
    saleType: 'group',
    isActive: true,
  },
];

async function installGroupProductRoute(page: Page) {
  await page.route(/\/products(?:\?|$)/, async (route) => {
    await route.fulfill({ json: { items: GROUP_PRODUCTS, total: GROUP_PRODUCTS.length } });
  });
}

test.describe('소비자 공동구매 페이지', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/groupbuy`);
  });

  test('페이지 정상 렌더링', async ({ page }) => {
    await expect(page.locator('text=공동구매')).toBeVisible();
  });

  test('모집 중 섹션 존재', async ({ page }) => {
    const empty = page.locator('text=진행 중인 공동구매가 없습니다');
    const list = page.locator('text=모집 중').first();
    // 리스트(모집 중) 또는 empty-state 중 하나가 확정 렌더될 때까지 대기.
    // 느린 로드로 둘 다 미렌더 상태에서 isEmpty=false 로 오판하던 flake 차단.
    await expect(list.or(empty)).toBeVisible({ timeout: 15_000 });
    if (!(await empty.isVisible())) {
      await expect(list).toBeVisible();
    }
  });

  test('공구 탭은 사용자 노출 상태 문구로 분류한다', async ({ page }) => {
    await page.waitForTimeout(2000); // 데이터 로딩 대기
    const empty = page.locator('text=진행 중인 공동구매가 없습니다');
    if (!(await empty.isVisible())) {
      await expect(
        page
          .locator('text=모집 중')
          .or(page.locator('text=모집 완료·종료'))
          .or(page.locator('text=정보 확인 필요'))
          .first(),
      ).toBeVisible();
      await expect(page.locator('body')).not.toContainText('�');
    }
  });

  test('모집 중·완료·정보 확인 필요 상품을 서로 다른 구역으로 분류한다', async ({ page }) => {
    await installGroupProductRoute(page);
    await page.reload();

    await expect(page.getByText('현재 1개 모집 중 · 마감 임박 0개')).toBeVisible();
    await expect(page.getByText('모집 중 공구 상품')).toBeVisible();
    await expect(page.getByText('모집 완료 공구 상품')).toBeVisible();
    await expect(page.getByText('정보 확인 공구 상품')).toBeVisible();
    await expect(page.getByText('모집 완료·종료')).toBeVisible();
    await expect(page.getByText('정보 확인 필요').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('�');
  });

  test('카드 클릭 시 상품 상세로 이동', async ({ page }) => {
    await page.waitForTimeout(2000);
    const card = page.locator('a[href*="/products/"]').first();
    const exists = await card.count();
    if (exists > 0) {
      await card.click();
      await expect(page).toHaveURL(/\/products\//);
    }
  });

  test('공구 상세는 배송 방법을 소비자 선택 버튼으로 열지 않는다', async ({ page }) => {
    await page.waitForTimeout(2000);
    const card = page.locator('a[href*="/products/"]').first();
    if ((await card.count()) > 0) {
      await card.click();
      await expect(page).toHaveURL(/\/products\//);
      const fixedDelivery = page.locator('text=판매자가 지정한 배송 방법');
      if (await fixedDelivery.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(fixedDelivery).toBeVisible();
        await expect(page.getByRole('button', { name: '꽃차 직배송' })).toHaveCount(0);
      }
    }
  });
});
