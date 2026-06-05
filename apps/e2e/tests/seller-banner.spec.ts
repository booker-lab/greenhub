import { expect, type Page, test } from '@playwright/test';
import { ADMIN_STATE_PATH } from './_helpers/auth';
import { expectNoHorizontalOverflow, setMobileViewport } from './_helpers/responsive';

const BASE = process.env.SELLER_BASE ?? 'https://seller.greenlove.co.kr';

test.describe('셀러 배너 관리', () => {
  test('미인증 접근 시 로그인 페이지로 리디렉션', async ({ page }) => {
    await page.goto(`${BASE}/admin/banner`);
    await expect(page).toHaveURL(/login|signin|auth/, { timeout: 10_000 });
  });

  test('로그인 페이지 정상 렌더링', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('input[type="email"], input[type="text"]').first()).toBeVisible();
  });
});

const adminEmail = process.env.TEST_ADMIN_EMAIL;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
const skipAuth = !adminEmail || !adminPassword;

const DEFAULT_BANNER = {
  id: 'main_hero',
  kind: 'default',
  imageUrl: '',
  tagText: '산지 직배송',
  headline: '기본 배너',
  subText: 'fixture 배너',
  cta1: { label: '상품 보기', href: '/products' },
  cta2: { label: '', href: '' },
};

const SCHEDULED_BANNER = {
  id: 'scheduled_fixture',
  kind: 'scheduled',
  imageUrl: '',
  tagText: '기간 한정',
  headline: '기간 배너 수정 전',
  subText: 'fixture 기간 배너',
  cta1: { label: '기획전 보기', href: '/events' },
  cta2: { label: '', href: '' },
  startDate: '2099-06-01',
  endDate: '2099-06-30',
};

interface BannerMockState {
  banners: (typeof DEFAULT_BANNER | typeof SCHEDULED_BANNER)[];
  deleteRequests: number;
  saveRequests: number;
  storageRequests: number;
}

interface BannerFixtureOptions {
  mutationMode?: 'fail' | 'success';
  scheduled?: boolean;
}

async function installBannerFixture(
  page: Page,
  options: BannerFixtureOptions = {},
): Promise<BannerMockState> {
  const state: BannerMockState = {
    banners: options.scheduled ? [DEFAULT_BANNER, SCHEDULED_BANNER] : [DEFAULT_BANNER],
    deleteRequests: 0,
    saveRequests: 0,
    storageRequests: 0,
  };

  await page.route('**/admin/banners**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ banners: state.banners }),
      });
      return;
    }

    if (options.mutationMode === 'success') {
      const id = new URL(request.url()).pathname.split('/').at(-1);
      if (request.method() === 'PUT' && id) {
        state.saveRequests += 1;
        const payload = request.postDataJSON();
        state.banners = state.banners.map((banner) =>
          banner.id === id ? { ...banner, ...payload, id } : banner,
        );
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      if (request.method() === 'DELETE' && id) {
        state.deleteRequests += 1;
        state.banners = state.banners.filter((banner) => banner.id !== id);
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
    }

    state.saveRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: '의도한 배너 저장 실패' }),
    });
  });

  await page.route('**/v0/b/**', async (route) => {
    state.storageRequests += 1;
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 403, message: '의도한 Storage 권한 실패' } }),
    });
  });

  return state;
}

async function openBannerAdmin(
  page: Page,
  options?: BannerFixtureOptions,
): Promise<BannerMockState> {
  const state = await installBannerFixture(page, options);
  await page.goto(`${BASE}/admin/banner`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('히어로 배너 관리')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('기본 배너', { exact: true })).toBeVisible();
  return state;
}

test.describe('Admin - 배너 실패 복구와 모바일 배치 회귀', () => {
  test.use({ storageState: ADMIN_STATE_PATH });
  test.skip(skipAuth, 'TEST_ADMIN_EMAIL/PASSWORD 미설정 - 어드민 인증 검증을 건너뜁니다');

  test('저장 실패 시 실패 사유를 알리고 저장 버튼 상태를 복구한다', async ({ page }) => {
    const state = await openBannerAdmin(page);

    await page.getByRole('button', { name: '수정', exact: true }).click();
    await page.getByLabel('헤드라인').fill('저장 실패 확인');
    await page.getByRole('button', { name: '저장', exact: true }).evaluate((button) => {
      button.click();
    });

    await expect(page.getByText('의도한 배너 저장 실패')).toBeVisible();
    await expect(page.getByRole('button', { name: '저장', exact: true })).toBeEnabled();
    expect(state.saveRequests).toBe(1);
  });

  test('Storage 업로드 실패 시 알림과 인라인 오류를 표시하고 입력을 초기화한다', async ({
    page,
  }) => {
    const state = await openBannerAdmin(page);

    await page.getByRole('button', { name: '수정', exact: true }).click();
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'upload-failure.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fixture'),
    });

    await expect.poll(() => state.storageRequests).toBeGreaterThan(0);
    await expect(page.getByText(/Firebase Storage|권한|오류/).first()).toBeVisible();
    await expect(page.getByText(/Firebase Storage|권한|오류/).last()).toBeVisible();
    await expect(fileInput).toHaveValue('');
    await expect(page.getByText('이미지 업로드', { exact: true })).toBeVisible();
  });

  test('모바일에서 CTA 입력은 1열로 쌓이고 Drawer가 가로 넘침을 만들지 않는다', async ({
    page,
  }) => {
    await setMobileViewport(page);
    await openBannerAdmin(page);

    await page.getByRole('button', { name: '새 배너', exact: true }).click();
    const inputs = page.getByLabel(/버튼[12] (문구|링크)/);
    await expect(inputs).toHaveCount(4);

    const getInputBoxes = () =>
      inputs.evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return {
            left: Math.round(box.left),
            right: Math.round(box.right),
            top: Math.round(box.top),
          };
        }),
      );
    await expect
      .poll(async () => new Set((await getInputBoxes()).map((box) => box.top)).size)
      .toBe(4);
    await expect
      .poll(async () => (await getInputBoxes()).every((box) => box.left >= -1 && box.right <= 376))
      .toBe(true);
    await expectNoHorizontalOverflow(page);
  });

  test('기간 배너 수정 저장과 삭제 후 목록을 갱신한다', async ({ page }) => {
    const state = await openBannerAdmin(page, { mutationMode: 'success', scheduled: true });

    await expect(page.getByText('기간 배너 수정 전', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '수정', exact: true }).nth(1).click();
    await page.getByLabel('헤드라인').fill('기간 배너 수정 완료');
    await page.getByRole('button', { name: '저장', exact: true }).click();

    await expect(page.getByText('배너를 저장했습니다.', { exact: true })).toBeVisible();
    await expect(page.getByText('기간 배너 수정', { exact: true })).not.toBeVisible();
    await expect(page.locator('p').filter({ hasText: /^기간 배너 수정 완료$/ })).toBeVisible();
    expect(state.saveRequests).toBe(1);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '삭제', exact: true }).click();

    await expect(page.getByText('배너를 삭제했습니다.', { exact: true })).toBeVisible();
    await expect(page.getByText('기간 배너 수정 완료', { exact: true })).not.toBeVisible();
    await expect(page.getByText('기본 배너', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '삭제', exact: true })).toHaveCount(0);
    expect(state.deleteRequests).toBe(1);
  });
});
