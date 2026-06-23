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

const STORES = [
  STORE,
  {
    id: 'store-beta',
    name: 'Store Beta',
    address: 'Busan Haeundae',
    phone: '010-2222-3333',
    logoUrl: null,
    productCount: 5,
    hubCount: 3,
  },
  {
    id: 'store-gamma',
    name: 'Garden Gamma',
    address: 'Daegu Suseong',
    phone: '010-3333-4444',
    logoUrl: null,
    productCount: 1,
    hubCount: 2,
  },
  {
    id: 'store-ready',
    name: 'Ready Later',
    address: 'Incheon Yeonsu',
    phone: '010-4444-5555',
    logoUrl: null,
    productCount: 0,
    hubCount: 9,
  },
];

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
          items: STORES,
          total: STORES.length,
        },
      });
    }

    const detailStore = STORES.find((store) => url.pathname === `/public/stores/${store.id}`);
    if (detailStore) {
      return route.fulfill({
        json: {
          store: detailStore,
          products: detailStore.id === STORE.id ? [PRODUCT] : [],
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

  test('상점 목록에서 검색과 정렬을 클라이언트 상태로 적용한다', async ({ page }) => {
    await installPublicStoreRoutes(page);

    await page.goto(`${BASE}/stores`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('a[href^="/stores/"]')).toHaveCount(STORES.length);
    const initialCards = await page
      .locator('a[href^="/stores/"]')
      .evaluateAll((cards) => cards.map((card) => card.textContent ?? ''));
    expect(initialCards.at(-1)).toContain('Ready Later');
    await expect(page.getByText('준비 중', { exact: true })).toBeVisible();
    await expect(page.getByText('상품 준비 중')).toBeVisible();

    await page.getByLabel('상점 검색').fill('Busan');
    await expect(page.getByText('Store Beta')).toBeVisible();
    await expect(page.getByText('Store Alpha')).toBeHidden();

    await page.getByLabel('상점 검색').fill('없는상점');
    await expect(page.getByText('검색 조건에 맞는 상점이 없습니다.')).toBeVisible();
    await page.getByRole('button', { name: '검색 초기화' }).click();
    await expect(page.getByText('Store Alpha')).toBeVisible();

    await page.getByRole('radio', { name: '구매 가능순' }).click();

    const cardTexts = await page
      .locator('a[href^="/stores/"]')
      .evaluateAll((cards) => cards.map((card) => card.textContent ?? ''));
    expect(cardTexts[0]).toContain('Store Beta');
    expect(cardTexts[1]).toContain('Store Alpha');
    expect(cardTexts.at(-1)).toContain('Ready Later');

    await page.getByRole('radio', { name: '거점 수순' }).click();
    const hubSortedCardTexts = await page
      .locator('a[href^="/stores/"]')
      .evaluateAll((cards) => cards.map((card) => card.textContent ?? ''));
    expect(hubSortedCardTexts[0]).toContain('Store Beta');
    expect(hubSortedCardTexts.at(-1)).toContain('Ready Later');
  });

  test('모바일 상점 상세는 가로 넘침 없이 상품 진입 링크를 유지한다', async ({ page }) => {
    await setMobileViewport(page);
    await installPublicStoreRoutes(page);

    await page.goto(`${BASE}/stores/store-alpha`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText(STORE.name)).toBeVisible();
    await expect(page.getByText(PRODUCT.name)).toBeVisible();
    await expect(page.locator('[data-product-card-variant="store"]')).toHaveCount(1);
    const gridColumns = await page.getByTestId('store-product-grid').evaluate((element) => {
      return getComputedStyle(element).gridTemplateColumns.split(' ').length;
    });
    expect(gridColumns).toBe(2);
    await expectNoHorizontalOverflow(page);
  });

  test('상점 상세 상품 링크는 복귀 맥락을 유지한다', async ({ page }) => {
    await installPublicStoreRoutes(page);

    await page.goto(`${BASE}/stores/store-alpha`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText(STORE.name)).toBeVisible();

    const productLink = page.locator('a[href^="/products/fixture-product-alpha"]');
    const productHref = await productLink.getAttribute('href');
    expect(productHref).not.toBeNull();
    const productUrl = new URL(productHref ?? '', BASE);
    expect(productUrl.searchParams.get('fromStore')).toBe(STORE.id);
    expect(productUrl.searchParams.get('storeName')).toBe(STORE.name);

    await productLink.click();
    await expect(page).toHaveURL(/\/products\/fixture-product-alpha/);
    await page.goBack();
    await expect(page).toHaveURL(/\/stores\/store-alpha/);
  });
});
