import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import {
  installPortOneBrowserStub,
  roundDirectFixture,
  type RoundDirectFixture,
} from './_helpers/round-direct';
import { resolveE2ETargetUrl } from './_helpers/target-url';

const BASE = resolveE2ETargetUrl('driver');
const DELIVERY_PHOTO_PATH = resolve(__dirname, '../fixtures/round-direct-delivery.jpg');

type RoundDirectDriverFixtures = {
  roundDirect: RoundDirectFixture;
  providerEgressGuard: void;
};

const test = base.extend<RoundDirectDriverFixtures>({
  roundDirect: async ({}, use, testInfo) => {
    await use(roundDirectFixture(testInfo));
  },
  storageState: async ({ roundDirect }, use) => {
    await use(roundDirect.statePath);
  },
  providerEgressGuard: [
    async ({ page }, use) => {
      const provider = await installPortOneBrowserStub(page);
      await use();
      provider.assertNoProviderEgress();
    },
    { auto: true },
  ],
});

async function installDeliveryPhotoCamera(page: Page, idempotencyKey: string): Promise<void> {
  const jpegBase64 = (await readFile(DELIVERY_PHOTO_PATH)).toString('base64');
  await page.addInitScript(({ encodedJpeg, deterministicIdempotencyKey }) => {
    const bytes = Uint8Array.from(atob(encodedJpeg), (character) => character.charCodeAt(0));
    const jpeg = new Blob([bytes], { type: 'image/jpeg' });
    const mediaDevices = navigator.mediaDevices ?? {};

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: mediaDevices,
    });
    Object.defineProperty(mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => new MediaStream(),
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: async () => undefined,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => ({ drawImage: () => undefined }),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      value: (callback: BlobCallback) => callback(jpeg),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
      configurable: true,
      value: () => `data:image/jpeg;base64,${encodedJpeg}`,
    });
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: () => deterministicIdempotencyKey,
    });
  }, { encodedJpeg: jpegBase64, deterministicIdempotencyKey: idempotencyKey });
}

/**
 * 상태 변경 시나리오가 서로의 전제와 결과를 오염시키지 않도록 주문별 fixture를 분리한다.
 * suffix는 공용 도우미에서 실행 ID와 Playwright project가 포함된 실제 ID로 확장된다.
 */
const ORDER_FIXTURE_SUFFIXES = {
  BOARD_DIRECT: 'driver-round-direct-board',
  BOARD_HUB: 'driver-round-hub-excluded',
  BOARD_PARCEL_EXCLUDED: 'driver-round-parcel-excluded',
  START_PREPARING: 'driver-round-direct-start-preparing',
  HOLD_WEATHER: 'driver-round-direct-hold-weather',
  HOLD_ACCESS: 'driver-round-direct-hold-access',
  HOLD_ADDRESS: 'driver-round-direct-hold-address',
  HOLD_UNREACHABLE: 'driver-round-direct-hold-unreachable',
  RESUME_HELD: 'driver-round-direct-resume-held',
  PHOTO_REQUIRED: 'driver-round-direct-photo-required',
} as const;

test.describe('드라이버 회차 직배송 화면 계약', () => {
  test('배송 보드는 직접배송과 거점배송 주문을 노출하고 택배 주문은 제외한다', async ({ page, roundDirect }) => {
    await page.goto(`${BASE}/board?tab=preparing`);

    await expect(
      page.getByTestId(
        `driver-order-${roundDirect.orderId(ORDER_FIXTURE_SUFFIXES.BOARD_DIRECT)}`,
      ),
    ).toBeVisible();
    await expect(
      page.getByTestId(
        `driver-order-${roundDirect.orderId(ORDER_FIXTURE_SUFFIXES.BOARD_HUB)}`,
      ),
    ).toBeVisible();
    await expect(
      page.getByTestId(
        `driver-order-${roundDirect.orderId(ORDER_FIXTURE_SUFFIXES.BOARD_PARCEL_EXCLUDED)}`,
      ),
    ).toHaveCount(0);
  });

  test('준비된 직접배송 주문의 배송을 시작한다', async ({ page, roundDirect }) => {
    const orderId = roundDirect.orderId(ORDER_FIXTURE_SUFFIXES.START_PREPARING);
    await page.goto(`${BASE}/board/${orderId}`);

    await expect(page.getByText('직배송')).toBeVisible();
    await page.getByRole('button', { name: '수거 완료 / 배송 시작' }).click();

    await expect(page.getByText('배송 중')).toBeVisible();
    await expect(page.getByRole('button', { name: '수거 완료 / 배송 시작' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /소비자에게 전화/ })).toBeVisible();
  });

  test('기상 사유는 고객 책임과 재배송비 없이 새 일정으로 보류한다', async ({
    page,
    roundDirect,
  }) => {
    const orderId = roundDirect.orderId(ORDER_FIXTURE_SUFFIXES.HOLD_WEATHER);
    await page.goto(`${BASE}/board/${orderId}`);

    await page.getByRole('button', { name: '배송 보류' }).click();
    await page.getByRole('radio', { name: '기상 악화' }).check();
    await page.getByLabel('보류 사유').fill('강풍으로 안전한 배송이 어렵습니다.');
    await page.getByLabel('새 배송 예정').fill('2026-07-22T08:00');

    await expect(page.getByRole('checkbox', { name: '고객 책임' })).not.toBeChecked();
    await expect(page.getByLabel('재배송비')).toBeDisabled();
    await page.getByRole('button', { name: '배송 보류 저장' }).click();

    await expect(page.getByRole('dialog', { name: '배송 보류 기록' })).toHaveCount(0);
    await expect(
      page.getByRole('main').getByRole('paragraph').filter({ hasText: /^배송 보류$/ }),
    ).toBeVisible();
    await expect(page.getByText('기상 악화')).toBeVisible();
    await expect(page.getByText('판매자 책임')).toBeVisible();
    await expect(page.getByText('재배송비 없음')).toBeVisible();
    await expect(page.getByText(/새 배송.*2026.*7.*22/)).toBeVisible();
  });

  test('출입 실패는 고객 책임·재배송비·다음 연락·새 일정을 기록한다', async ({
    page,
    roundDirect,
  }) => {
    const orderId = roundDirect.orderId(ORDER_FIXTURE_SUFFIXES.HOLD_ACCESS);
    await page.goto(`${BASE}/board/${orderId}`);

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

  test('주소 실패는 고객 책임·재배송비·다음 연락·새 일정을 기록한다', async ({
    page,
    roundDirect,
  }) => {
    const orderId = roundDirect.orderId(ORDER_FIXTURE_SUFFIXES.HOLD_ADDRESS);
    await page.goto(`${BASE}/board/${orderId}`);

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

  test('연락 실패는 고객 책임·재배송비·다음 연락·새 일정을 기록한다', async ({
    page,
    roundDirect,
  }) => {
    const orderId = roundDirect.orderId(ORDER_FIXTURE_SUFFIXES.HOLD_UNREACHABLE);
    await page.goto(`${BASE}/board/${orderId}`);

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

  test('담당 기사는 보류 주문을 보드에서 찾아 배송을 재개한다', async ({
    page,
    roundDirect,
  }) => {
    await page.goto(`${BASE}/board?tab=delivering`);

    const orderId = roundDirect.orderId(ORDER_FIXTURE_SUFFIXES.RESUME_HELD);
    const heldOrder = page.getByTestId(`driver-order-${orderId}`);
    await expect(heldOrder).toBeVisible();
    await expect(heldOrder.getByText('배송 보류')).toBeVisible();
    await heldOrder.click();

    await expect(page).toHaveURL(new RegExp(`/board/${orderId}$`));
    await expect(page.getByRole('button', { name: '배송 재개' })).toBeVisible();
    await expect(page.getByText('재배송비 결제 완료')).toBeVisible();
    await page.getByRole('button', { name: '배송 재개' }).click();

    await expect(page.getByRole('banner').getByText('배송 중', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '배송 완료 사진 촬영' })).toBeVisible();
  });

  test('직접배송 완료는 사진을 등록한 뒤에만 정상 완료한다', async ({
    page,
    roundDirect,
  }) => {
    await installDeliveryPhotoCamera(page, `${roundDirect.namespace}-photo-upload`);
    const orderId = roundDirect.orderId(ORDER_FIXTURE_SUFFIXES.PHOTO_REQUIRED);
    await page.goto(`${BASE}/board/${orderId}`);

    await expect(page.getByRole('button', { name: '배송 완료' })).toHaveCount(0);
    await page.getByRole('button', { name: '배송 완료 사진 촬영' }).click();

    await expect(page).toHaveURL(new RegExp(`/board/${orderId}/photo(?:\\?|$)`));
    await expect(page.getByRole('heading', { name: '배송 완료 사진' })).toBeVisible();
    const completeButton = page.getByRole('button', { name: '사진을 등록하고 배송 완료' });
    await expect(completeButton).toBeDisabled();

    await page.getByRole('button', { name: '사진 촬영', exact: true }).click();
    await expect(page.locator('video')).toBeVisible();
    await page.getByRole('button', { name: '사진 촬영', exact: true }).click();

    await expect(page.getByAltText('촬영 미리보기')).toBeVisible();
    await expect(completeButton).toBeEnabled();
    await completeButton.click();

    await expect(page).toHaveURL(new RegExp('/board\\?tab=preparing$'));
    await expect(page.getByTestId(`driver-order-${orderId}`)).toHaveCount(0);
  });
});
