import { expect, test } from '@playwright/test';

const BASE = process.env.DRIVER_BASE ?? 'https://driver.greenlove.co.kr';
const sessionCookie = process.env.DRIVER_SESSION_COOKIE;

/**
 * 상태 변경 시나리오가 서로의 전제와 결과를 오염시키지 않도록 주문별 fixture를 분리한다.
 * 실제 seed와 드라이버 화면이 준비되는 Task 6.7 전까지 아래 계약은 의도적으로 fixme로 유지한다.
 */
const ORDER_FIXTURE_IDS = {
  BOARD_DIRECT: 'driver-round-direct-board',
  BOARD_HUB_EXCLUDED: 'driver-round-hub-excluded',
  BOARD_PARCEL_EXCLUDED: 'driver-round-parcel-excluded',
  START_PREPARING: 'driver-round-direct-start-preparing',
  HOLD_WEATHER: 'driver-round-direct-hold-weather',
  HOLD_ACCESS: 'driver-round-direct-hold-access',
  HOLD_ADDRESS: 'driver-round-direct-hold-address',
  HOLD_UNREACHABLE: 'driver-round-direct-hold-unreachable',
  PHOTO_REQUIRED: 'driver-round-direct-photo-required',
} as const;

test.describe('드라이버 회차 직배송 화면 계약', () => {
  test.skip(!sessionCookie, '환경변수 DRIVER_SESSION_COOKIE 필요');

  test.beforeEach(async ({ context }) => {
    if (!sessionCookie) {
      throw new Error('환경변수 DRIVER_SESSION_COOKIE가 필요합니다.');
    }
    const cookies = JSON.parse(sessionCookie) as Array<{
      name: string;
      value: string;
      domain?: string;
      path?: string;
    }>;
    const domain = new URL(BASE).hostname;
    await context.addCookies(
      cookies.map((cookie) => ({ ...cookie, domain, path: cookie.path ?? '/' })),
    );
  });

  test.fixme('배송 보드는 직접배송 주문만 노출한다', async ({ page }) => {
    await page.goto(`${BASE}/board?tab=preparing`);

    await expect(page.getByTestId(`driver-order-${ORDER_FIXTURE_IDS.BOARD_DIRECT}`)).toBeVisible();
    await expect(
      page.getByTestId(`driver-order-${ORDER_FIXTURE_IDS.BOARD_HUB_EXCLUDED}`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`driver-order-${ORDER_FIXTURE_IDS.BOARD_PARCEL_EXCLUDED}`),
    ).toHaveCount(0);
  });

  test.fixme('준비된 직접배송 주문의 배송을 시작한다', async ({ page }) => {
    await page.goto(`${BASE}/board/${ORDER_FIXTURE_IDS.START_PREPARING}`);

    await expect(page.getByText('직배송')).toBeVisible();
    await page.getByRole('button', { name: '수거 완료 / 배송 시작' }).click();

    await expect(page.getByText('배송 중')).toBeVisible();
    await expect(page.getByRole('button', { name: '수거 완료 / 배송 시작' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /소비자에게 전화/ })).toBeVisible();
  });

  test.fixme('기상 사유는 고객 책임과 재배송비 없이 새 일정으로 보류한다', async ({ page }) => {
    await page.goto(`${BASE}/board/${ORDER_FIXTURE_IDS.HOLD_WEATHER}`);

    await page.getByRole('button', { name: '배송 보류' }).click();
    await page.getByRole('radio', { name: '기상 악화' }).check();
    await page.getByLabel('보류 사유').fill('강풍으로 안전한 배송이 어렵습니다.');
    await page.getByLabel('새 배송 예정').fill('2026-07-22T08:00');

    await expect(page.getByRole('checkbox', { name: '고객 책임' })).not.toBeChecked();
    await expect(page.getByLabel('재배송비')).toBeDisabled();
    await page.getByRole('button', { name: '배송 보류 저장' }).click();

    await expect(page.getByText('배송 보류')).toBeVisible();
    await expect(page.getByText('기상 악화')).toBeVisible();
    await expect(page.getByText('판매자 책임')).toBeVisible();
    await expect(page.getByText('재배송비 없음')).toBeVisible();
    await expect(page.getByText(/새 배송.*2026.*7.*22/)).toBeVisible();
  });

  test.fixme('출입 실패는 고객 책임·재배송비·다음 연락·새 일정을 기록한다', async ({ page }) => {
    await page.goto(`${BASE}/board/${ORDER_FIXTURE_IDS.HOLD_ACCESS}`);

    await page.getByRole('button', { name: '배송 보류' }).click();
    await page.getByRole('radio', { name: '출입 불가' }).check();
    await page.getByLabel('보류 사유').fill('공동현관 출입 정보를 확인할 수 없습니다.');
    await page.getByRole('checkbox', { name: '고객 책임' }).check();
    await page.getByLabel('재배송비').fill('3000');
    await page.getByLabel('다음 연락 예정').fill('2026-07-22T09:00');
    await page.getByLabel('새 배송 예정').fill('2026-07-22T11:00');
    await page.getByRole('button', { name: '배송 보류 저장' }).click();

    await expect(page.getByText('출입 불가')).toBeVisible();
    await expect(page.getByText('고객 책임')).toBeVisible();
    await expect(page.getByText(/재배송비.*3,000원/)).toBeVisible();
    await expect(page.getByText(/다음 연락.*2026.*7.*22.*9:00/)).toBeVisible();
    await expect(page.getByText(/새 배송.*2026.*7.*22.*11:00/)).toBeVisible();
  });

  test.fixme('주소 실패는 고객 책임·재배송비·다음 연락·새 일정을 기록한다', async ({ page }) => {
    await page.goto(`${BASE}/board/${ORDER_FIXTURE_IDS.HOLD_ADDRESS}`);

    await page.getByRole('button', { name: '배송 보류' }).click();
    await page.getByRole('radio', { name: '주소 오류' }).check();
    await page.getByLabel('보류 사유').fill('상세 주소가 없어 배송지를 확인할 수 없습니다.');
    await page.getByRole('checkbox', { name: '고객 책임' }).check();
    await page.getByLabel('재배송비').fill('3000');
    await page.getByLabel('다음 연락 예정').fill('2026-07-22T09:30');
    await page.getByLabel('새 배송 예정').fill('2026-07-22T11:30');
    await page.getByRole('button', { name: '배송 보류 저장' }).click();

    await expect(page.getByText('주소 오류')).toBeVisible();
    await expect(page.getByText('고객 책임')).toBeVisible();
    await expect(page.getByText(/재배송비.*3,000원/)).toBeVisible();
    await expect(page.getByText(/다음 연락.*2026.*7.*22.*9:30/)).toBeVisible();
    await expect(page.getByText(/새 배송.*2026.*7.*22.*11:30/)).toBeVisible();
  });

  test.fixme('연락 실패는 고객 책임·재배송비·다음 연락·새 일정을 기록한다', async ({ page }) => {
    await page.goto(`${BASE}/board/${ORDER_FIXTURE_IDS.HOLD_UNREACHABLE}`);

    await page.getByRole('button', { name: '배송 보류' }).click();
    await page.getByRole('radio', { name: '고객 연락 불가' }).check();
    await page.getByLabel('보류 사유').fill('배송지 확인을 위해 연락했으나 응답이 없습니다.');
    await page.getByRole('checkbox', { name: '고객 책임' }).check();
    await page.getByLabel('재배송비').fill('3000');
    await page.getByLabel('다음 연락 예정').fill('2026-07-22T10:00');
    await page.getByLabel('새 배송 예정').fill('2026-07-22T12:00');
    await page.getByRole('button', { name: '배송 보류 저장' }).click();

    await expect(page.getByText('고객 연락 불가')).toBeVisible();
    await expect(page.getByText('고객 책임')).toBeVisible();
    await expect(page.getByText(/재배송비.*3,000원/)).toBeVisible();
    await expect(page.getByText(/다음 연락.*2026.*7.*22.*10:00/)).toBeVisible();
    await expect(page.getByText(/새 배송.*2026.*7.*22.*12:00/)).toBeVisible();
  });

  test.fixme('직접배송 완료는 사진 촬영 화면에서만 제공하고 촬영 전에는 비활성화한다', async ({
    page,
  }) => {
    await page.goto(`${BASE}/board/${ORDER_FIXTURE_IDS.PHOTO_REQUIRED}`);

    await expect(page.getByRole('button', { name: '배송 완료' })).toHaveCount(0);
    await page.getByRole('link', { name: '완료 사진 촬영' }).click();

    await expect(page).toHaveURL(
      new RegExp(`/board/${ORDER_FIXTURE_IDS.PHOTO_REQUIRED}/photo(?:\\?|$)`),
    );
    await expect(page.getByRole('heading', { name: '배송 완료 사진' })).toBeVisible();
    await expect(page.getByRole('button', { name: '사진 촬영' })).toBeVisible();
    await expect(page.getByRole('button', { name: '사진을 등록하고 배송 완료' })).toBeDisabled();
  });
});
