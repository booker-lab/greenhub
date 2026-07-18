import { expect, test } from '@playwright/test';
import { AUTH_STATE_PATH } from './_helpers/auth';

const BASE = process.env.SELLER_BASE ?? 'https://seller.greenlove.co.kr';

const sellerEmail = process.env.TEST_SELLER_EMAIL;
const sellerPassword = process.env.TEST_SELLER_PASSWORD;
const skipAuth = !sellerEmail || !sellerPassword;

/**
 * 상태 변경 시나리오가 서로의 전제와 결과를 오염시키지 않도록 회차별 fixture를 분리한다.
 * 실제 seed와 화면이 준비되는 Task 6.7 전까지 아래 계약은 의도적으로 fixme 상태를 유지한다.
 */
const ROUND_FIXTURE_IDS = {
  COPY_SOURCE_COMPLETED: 'seller-round-copy-source-completed',
  SCHEDULE_DRAFT: 'seller-round-schedule-draft',
  CLOSE_OPEN: 'seller-round-close-open',
  COMPLETE_BLOCKED_BY_HELD_ORDER: 'seller-round-complete-blocked-held',
  COMPLETE_READY: 'seller-round-complete-ready',
  CONFIRMATION_REQUIRED: 'seller-round-confirmation-required',
} as const;

test.describe('Seller 회차 운영 화면 계약', () => {
  test.use({ storageState: AUTH_STATE_PATH });
  test.skip(skipAuth, '환경변수 TEST_SELLER_EMAIL / TEST_SELLER_PASSWORD 필요');

  test.fixme('완료 회차를 복사하면 별도의 작성 중 회차가 생성된다', async ({ page }) => {
    await page.goto(`${BASE}/sale-rounds`);

    const sourceRound = page.getByTestId(`sale-round-${ROUND_FIXTURE_IDS.COPY_SOURCE_COMPLETED}`);
    await expect(sourceRound.getByText('배송 완료')).toBeVisible();
    await sourceRound.getByRole('button', { name: '이전 회차 복사' }).click();

    await expect(page.getByRole('dialog', { name: '이전 회차 복사' })).toBeVisible();
    await expect(page.getByLabel('회차 이름')).toBeVisible();
    await expect(page.getByLabel('주문 시작')).toBeVisible();
    await expect(page.getByLabel('주문 마감')).toBeVisible();
    await expect(page.getByRole('button', { name: '회차 복사' })).toBeVisible();
  });

  test.fixme('작성 중 회차를 판매 예정으로 예약한다', async ({ page }) => {
    await page.goto(`${BASE}/sale-rounds/${ROUND_FIXTURE_IDS.SCHEDULE_DRAFT}`);

    await expect(page.getByText('작성 중')).toBeVisible();
    await page.getByRole('button', { name: '판매 예정으로 예약' }).click();
    await page.getByRole('button', { name: '예약 확인' }).click();

    await expect(page.getByText('판매 예정')).toBeVisible();
    await expect(page.getByRole('button', { name: '판매 예정으로 예약' })).toHaveCount(0);
  });

  test.fixme('판매 중 회차의 주문을 수동 마감한다', async ({ page }) => {
    await page.goto(`${BASE}/sale-rounds/${ROUND_FIXTURE_IDS.CLOSE_OPEN}`);

    await expect(page.getByText('판매 중')).toBeVisible();
    await page.getByRole('button', { name: '주문 마감' }).click();
    await page.getByRole('button', { name: '마감 확인' }).click();

    await expect(page.getByText('주문 마감')).toBeVisible();
    await expect(page.getByText('수동 마감')).toBeVisible();
  });

  test.fixme('배송 보류 주문이 남은 마감 회차는 완료를 거부한다', async ({ page }) => {
    await page.goto(`${BASE}/sale-rounds/${ROUND_FIXTURE_IDS.COMPLETE_BLOCKED_BY_HELD_ORDER}`);

    await expect(page.getByText('주문 마감')).toBeVisible();
    await expect(page.getByText(/배송 보류 1건/)).toBeVisible();
    await page.getByRole('button', { name: '회차 완료' }).click();
    await page.getByRole('button', { name: '완료 확인' }).click();

    await expect(
      page.getByText('미완료 또는 배송 보류 주문이 남아 있어 회차를 완료할 수 없습니다.'),
    ).toBeVisible();
    await expect(page.getByText('주문 마감')).toBeVisible();
  });

  test.fixme('미완료 주문이 없는 마감 회차를 정상 완료한다', async ({ page }) => {
    await page.goto(`${BASE}/sale-rounds/${ROUND_FIXTURE_IDS.COMPLETE_READY}`);

    await expect(page.getByText('주문 마감')).toBeVisible();
    await expect(page.getByText(/배송 보류 0건/)).toBeVisible();
    await page.getByRole('button', { name: '회차 완료' }).click();
    await page.getByRole('button', { name: '완료 확인' }).click();

    await expect(page.getByText('배송 완료')).toBeVisible();
    await expect(page.getByRole('button', { name: '회차 완료' })).toHaveCount(0);
  });

  test.fixme('확인 필요 건수에서 셀러 주문 업무로 진입한다', async ({ page }) => {
    await page.goto(`${BASE}/sale-rounds/${ROUND_FIXTURE_IDS.CONFIRMATION_REQUIRED}`);

    await page.getByRole('link', { name: /확인 필요 2건/ }).click();

    await expect(page).toHaveURL(/\/orders\?tab=ACTION_REQUIRED$/);
    await expect(page.getByRole('heading', { name: '주문 관리' })).toBeVisible();
    await expect(page.getByText('확인 필요')).toBeVisible();
  });
});
