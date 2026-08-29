import { expect, test as base } from '@playwright/test';
import {
  installPortOneBrowserStub,
  roundDirectFixture,
  type RoundDirectFixture,
} from './_helpers/round-direct';
import { resolveE2ETargetUrl } from './_helpers/target-url';

const BASE = resolveE2ETargetUrl('seller');

type RoundDirectSellerFixtures = {
  roundDirect: RoundDirectFixture;
  providerEgressGuard: void;
};

const test = base.extend<RoundDirectSellerFixtures>({
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

/**
 * 상태 변경 시나리오가 서로의 전제와 결과를 오염시키지 않도록 회차별 fixture를 분리한다.
 * suffix는 공용 도우미에서 실행 ID와 Playwright project가 포함된 실제 ID로 확장된다.
 */
const ROUND_FIXTURE_SUFFIXES = {
  COPY_SOURCE_COMPLETED: 'seller-round-copy-source-completed',
  SCHEDULE_DRAFT: 'seller-round-schedule-draft',
  CLOSE_OPEN: 'seller-round-close-open',
  COMPLETE_BLOCKED_BY_HELD_ORDER: 'seller-round-complete-blocked-held',
  COMPLETE_READY: 'seller-round-complete-ready',
  CONFIRMATION_REQUIRED: 'seller-round-confirmation-required',
} as const;

test.describe('Seller 회차 운영 화면 계약', () => {
  test('완료 회차를 복사하면 별도의 작성 중 회차가 생성된다', async ({
    page,
    roundDirect,
  }) => {
    await page.goto(`${BASE}/sale-rounds`);

    const sourceRoundId = roundDirect.sellerRoundId(
      ROUND_FIXTURE_SUFFIXES.COPY_SOURCE_COMPLETED,
    );
    const sourceRound = page.getByTestId(`sale-round-${sourceRoundId}`);
    await expect(sourceRound.getByText('배송 완료')).toBeVisible();
    await sourceRound.getByRole('button', { name: '이전 회차 복사' }).click();

    const copyDialog = page.getByRole('dialog', { name: '이전 회차 복사' });
    await expect(copyDialog).toBeVisible();
    await expect(copyDialog.getByLabel('회차 이름')).toBeVisible();
    await expect(copyDialog.getByLabel('주문 시작')).toBeVisible();
    await expect(copyDialog.getByLabel('주문 마감')).toBeVisible();
    await expect(copyDialog.getByRole('button', { name: '회차 복사', exact: true })).toBeVisible();
  });

  test('작성 중 회차를 판매 예정으로 예약한다', async ({ page, roundDirect }) => {
    const roundId = roundDirect.sellerRoundId(ROUND_FIXTURE_SUFFIXES.SCHEDULE_DRAFT);
    await page.goto(`${BASE}/sale-rounds/${roundId}`);

    await expect(page.getByText('작성 중')).toBeVisible();
    await page.getByRole('button', { name: '판매 예정으로 예약' }).click();
    await page.getByRole('button', { name: '예약 확인' }).click();

    await expect(page.getByRole('button', { name: '판매 예정으로 예약' })).toHaveCount(0);
    await expect(page.getByText('판매 예정', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '판매 예정으로 예약' })).toHaveCount(0);
  });

  test('판매 중 회차의 주문을 수동 마감한다', async ({ page, roundDirect }) => {
    const roundId = roundDirect.sellerRoundId(ROUND_FIXTURE_SUFFIXES.CLOSE_OPEN);
    await page.goto(`${BASE}/sale-rounds/${roundId}`);

    await expect(page.getByText('판매 중')).toBeVisible();
    await page.getByRole('button', { name: '주문 마감' }).click();
    await page.getByRole('button', { name: '마감 확인' }).click();

    await expect(page.getByRole('button', { name: '주문 마감' })).toHaveCount(0);
    await expect(page.getByText('수동 마감', { exact: true })).toBeVisible();
  });

  test('배송 보류 주문이 남은 마감 회차는 완료를 거부한다', async ({
    page,
    roundDirect,
  }) => {
    const roundId = roundDirect.sellerRoundId(
      ROUND_FIXTURE_SUFFIXES.COMPLETE_BLOCKED_BY_HELD_ORDER,
    );
    await page.goto(`${BASE}/sale-rounds/${roundId}`);

    await expect(page.getByText('주문 마감')).toBeVisible();
    await expect(
      page.getByText('배송 보류', { exact: true }).locator('..').getByText('1건', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '회차 완료' }).click();
    await page.getByRole('button', { name: '완료 확인' }).click();

    await expect(
      page.getByText('미완료 또는 배송 보류 주문이 남아 있어 회차를 완료할 수 없습니다.'),
    ).toBeVisible();
    await expect(page.getByText('수동 마감', { exact: true })).toBeVisible();
  });

  test('미완료 주문이 없는 마감 회차를 정상 완료한다', async ({ page, roundDirect }) => {
    const roundId = roundDirect.sellerRoundId(ROUND_FIXTURE_SUFFIXES.COMPLETE_READY);
    await page.goto(`${BASE}/sale-rounds/${roundId}`);

    await expect(page.getByText('주문 마감')).toBeVisible();
    await expect(
      page.getByText('배송 보류', { exact: true }).locator('..').getByText('0건', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '회차 완료' }).click();
    await page.getByRole('button', { name: '완료 확인' }).click();

    await expect(page.getByText('배송 완료')).toBeVisible();
    await expect(page.getByRole('button', { name: '회차 완료' })).toHaveCount(0);
  });

  test('확인 필요 건수에서 셀러 주문 업무로 진입한다', async ({ page, roundDirect }) => {
    const roundId = roundDirect.sellerRoundId(ROUND_FIXTURE_SUFFIXES.CONFIRMATION_REQUIRED);
    await page.goto(`${BASE}/sale-rounds/${roundId}`);

    await page.getByRole('link', { name: /확인 필요 2건/ }).click();

    await expect(page).toHaveURL(/\/orders\?tab=ACTION_REQUIRED$/);
    await expect(page.getByRole('heading', { name: '주문 관리' })).toBeVisible();
    await expect(page.getByRole('button', { name: /확인 필요 \d+건 확인/ })).toBeVisible();
  });
});
