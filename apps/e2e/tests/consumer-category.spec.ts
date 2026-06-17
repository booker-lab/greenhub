import { expect, type Page, test } from '@playwright/test';

const BASE = process.env.CONSUMER_BASE ?? 'http://localhost:3010';

const PRODUCTS = [
  {
    id: 'orchid-normal-red',
    storeId: 'store-alpha',
    name: '레드 난',
    price: 30000,
    images: ['/icons/icon-192x192.png'],
    category: 'orchid',
    colors: ['레드', '핑크'],
    saleType: 'normal',
    isActive: true,
  },
  {
    id: 'flower-normal-white',
    storeId: 'store-alpha',
    name: '화이트 절화',
    price: 20000,
    images: ['/icons/icon-192x192.png'],
    category: 'cut_flower',
    colors: ['화이트'],
    saleType: 'normal',
    isActive: true,
  },
  {
    id: 'orchid-group-red',
    storeId: 'store-alpha',
    name: '공동구매 난',
    price: 40000,
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
];

async function installProductRoute(page: Page, urls: string[] = []) {
  await page.route(/\/products(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    urls.push(url.toString());
    let items = [...PRODUCTS];

    const category = url.searchParams.get('category');
    const saleType = url.searchParams.get('saleType');
    const colors = url.searchParams.getAll('colors');
    const sort = url.searchParams.get('sort') ?? 'latest';

    if (category) items = items.filter((item) => item.category === category);
    if (saleType) items = items.filter((item) => item.saleType === saleType);
    if (colors.length > 0) {
      items = items.filter((item) => colors.some((color) => item.colors.includes(color)));
    }
    if (sort === 'price_asc') items.sort((a, b) => a.price - b.price);
    if (sort === 'price_desc') items.sort((a, b) => b.price - a.price);

    await route.fulfill({ json: { items, total: items.length } });
  });
}

test.describe('소비자 카테고리 탐색', () => {
  test('카테고리 탭은 URL과 선택 상태를 함께 갱신한다', async ({ page }) => {
    await installProductRoute(page);
    await page.goto(`${BASE}/category`);

    const orchidTab = page.getByTestId('category-tab-orchid');
    await orchidTab.click();

    await expect(page).toHaveURL(/category=orchid/);
    await expect(orchidTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('레드 난')).toBeVisible();
  });

  test('색상 필터는 펼침, 선택, 초기화를 URL에 반영한다', async ({ page }) => {
    await installProductRoute(page);
    await page.goto(`${BASE}/category`);

    await page.getByRole('button', { name: '색상' }).click();
    const redChip = page.getByTestId('category-color-레드');
    await redChip.click();

    await expect(page).toHaveURL(/colors=%EB%A0%88%EB%93%9C/);
    await expect(redChip).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('category-reset-colors').click();
    await expect(page).not.toHaveURL(/colors=/);
  });

  test('정렬 선택은 API 쿼리와 URL에 반영된다', async ({ page }) => {
    const urls: string[] = [];
    await installProductRoute(page, urls);
    await page.goto(`${BASE}/category`);

    await page.getByTestId('category-sort').selectOption('price_asc');

    await expect(page).toHaveURL(/sort=price_asc/);
    await expect.poll(() => urls.some((url) => url.includes('sort=price_asc'))).toBe(true);
    await expect(page.locator('a[href="/products/flower-normal-white"]')).toBeVisible();
  });

  test('공동구매 탭은 모집 조건과 마감 정보를 보여준다', async ({ page }) => {
    await installProductRoute(page);
    await page.goto(`${BASE}/category?saleType=group&colors=레드`);

    await expect(page.getByTestId('category-tab-group')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('공동구매 난')).toBeVisible();
    await expect(page.getByText('8/30개 모집 중')).toBeVisible();
    await expect(page.getByText(/최소 10개/)).toBeVisible();
  });

  test('검색 버튼은 검색 화면으로 이동한다', async ({ page }) => {
    await installProductRoute(page);
    await page.goto(`${BASE}/category`);

    await page.getByRole('link', { name: '상품 검색' }).click();

    await expect(page).toHaveURL(/\/search$/);
  });
});
