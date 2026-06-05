import { expect, type Page, test } from '@playwright/test';
import { expectNoHorizontalOverflow, setMobileViewport } from './_helpers/responsive';

const BASE = process.env.CONSUMER_BASE ?? 'http://localhost:3010';

const STORE = {
  id: 'store-alpha',
  name: 'Store Alpha',
  address: 'Seoul Jung-gu',
  phone: '010-1111-2222',
  logoUrl: null,
  productCount: 2,
  hubCount: 1,
};

const PRODUCT = {
  id: 'fixture-product-alpha',
  storeId: STORE.id,
  name: 'Fixture orchid',
  price: 32000,
  images: ['/icons/icon-192x192.png'],
  category: 'orchid',
  colors: [],
  saleType: 'normal',
  isActive: true,
};

async function installPublicStoreRoutes(page: Page) {
  await page.route('**/public/stores**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/public/stores') {
      return route.fulfill({
        json: {
          items: [STORE],
          total: 1,
        },
      });
    }

    if (url.pathname === `/public/stores/${STORE.id}`) {
      return route.fulfill({
        json: {
          store: STORE,
          products: [PRODUCT],
        },
      });
    }

    return route.fulfill({ status: 404, json: { message: 'not found' } });
  });
}

test.describe('소비자 상점 탐색 fixture', () => {
  test('상점 목록에서 상세와 상품 링크를 공개 API 응답만으로 표시한다', async ({ page }) => {
    await installPublicStoreRoutes(page);

    await page.goto(`${BASE}/stores`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('a[href="/stores/store-alpha"]')).toBeVisible();
    await expect(page.getByText(STORE.name)).toBeVisible();
    await expect(page.getByText(STORE.address)).toBeVisible();

    await page.locator('a[href="/stores/store-alpha"]').click();

    await expect(page).toHaveURL(/\/stores\/store-alpha/);
    await expect(page.getByText(PRODUCT.name)).toBeVisible();
    const productHref = await page
      .locator('a[href^="/products/fixture-product-alpha"]')
      .getAttribute('href');
    expect(productHref).not.toBeNull();
    const productUrl = new URL(productHref ?? '', BASE);
    expect(productUrl.pathname).toBe(`/products/${PRODUCT.id}`);
    expect(productUrl.searchParams.get('fromStore')).toBe(STORE.id);
    expect(productUrl.searchParams.get('storeName')).toBe(STORE.name);
  });

  test('모바일 상점 상세는 가로 넘침 없이 상품 진입 링크를 유지한다', async ({ page }) => {
    await setMobileViewport(page);
    await installPublicStoreRoutes(page);

    await page.goto(`${BASE}/stores/store-alpha`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText(STORE.name)).toBeVisible();
    await expect(page.getByText(PRODUCT.name)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('상품 상세 fixture는 상점 복귀와 판매자 정보 링크를 유지한다', async ({ page }) => {
    await installPublicStoreRoutes(page);

    await page.goto(`${BASE}/e2e/store-product-detail`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText(STORE.name)).toBeVisible();
    await expect(page.locator('a[href="/stores/store-alpha"]')).toBeVisible();

    await page.locator('header button').first().click();
    await expect(page).toHaveURL(/\/stores\/store-alpha/);
  });
});
