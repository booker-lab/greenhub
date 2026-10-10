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
  BULK_PREPARE: 'seller-round-bulk-prepare',
} as const;

/** 판매자 주문 상세 시나리오 주문. 기사가 아직 맡지 않은 주문이다. */
const ORDER_FIXTURE_SUFFIXES = {
  HOLD_RELEASE: 'seller-round-hold-release-order',
  HOLD_PREPARING: 'seller-round-hold-preparing-order',
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

    await expect(page.getByText('작성 중', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '판매 예정으로 예약' }).click();
    await page.getByRole('button', { name: '예약 확인' }).click();

    await expect(page.getByRole('button', { name: '판매 예정으로 예약' })).toHaveCount(0);
    await expect(page.getByText('판매 예정', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '판매 예정으로 예약' })).toHaveCount(0);
  });

  test('판매 중 회차의 주문을 수동 마감한다', async ({ page, roundDirect }) => {
    const roundId = roundDirect.sellerRoundId(ROUND_FIXTURE_SUFFIXES.CLOSE_OPEN);
    await page.goto(`${BASE}/sale-rounds/${roundId}`);

    await expect(page.getByText('판매 중', { exact: true })).toBeVisible();
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

    // 회차 상태 배지. 회차 편집 칸(일정 라벨·설명)이 늦게 뜨면 '주문 마감'이 여러 곳에 생기므로 정확히 일치로 찾는다.
    await expect(page.getByText('주문 마감', { exact: true })).toBeVisible();
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

    await expect(page.getByText('주문 마감', { exact: true })).toBeVisible();
    await expect(
      page.getByText('배송 보류', { exact: true }).locator('..').getByText('0건', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '회차 완료' }).click();
    await page.getByRole('button', { name: '완료 확인' }).click();

    await expect(page.getByText('배송 완료', { exact: true })).toBeVisible();
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

  test('마감 회차는 주문을 상태별로 세고 결제 완료 주문을 한꺼번에 준비 시작한다', async ({
    page,
    roundDirect,
  }) => {
    const roundId = roundDirect.sellerRoundId(ROUND_FIXTURE_SUFFIXES.BULK_PREPARE);
    await page.goto(`${BASE}/sale-rounds/${roundId}`);

    await expect(page.getByText('주문 마감', { exact: true })).toBeVisible();
    // 판매가 시작된 회차는 내용을 고칠 수 없다.
    await expect(page.getByText('고칠 수 없는 회차예요')).toBeVisible();
    await expect(page.getByRole('button', { name: '회차 저장' })).toHaveCount(0);
    // 구매 목록은 결제가 끝난 수량(상품 2종 × 2개, 배송지 2곳)이다.
    await expect(page.getByText('배송지 2곳 · 총 4개')).toBeVisible();

    await expect(page.getByRole('link', { name: '결제 완료 2건 주문 보기' })).toBeVisible();
    // 마감 뒤에도 준비 시작 전인 주문은 기사 화면에 나오지 않는다.
    await expect(page.getByText('기사 화면에 아직 안 보여요')).toBeVisible();
    await page.getByRole('button', { name: '결제 완료 2건 모두 준비 시작' }).click();
    await page.getByRole('button', { name: '2건 준비 시작', exact: true }).click();

    await expect(page.getByText('준비 시작을 마쳤어요')).toBeVisible();
    await expect(page.getByRole('link', { name: '준비 중 2건 주문 보기' })).toBeVisible();
    await expect(page.getByRole('link', { name: '결제 완료 0건 주문 보기' })).toBeVisible();
    await expect(page.getByText('기사 화면에 아직 안 보여요')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /모두 준비 시작/ })).toHaveCount(0);
  });

  test('기사 배정 전 무료 보류 주문을 재배송 준비로 돌린다', async ({ page, roundDirect }) => {
    const orderId = roundDirect.orderId(ORDER_FIXTURE_SUFFIXES.HOLD_RELEASE);
    await page.goto(`${BASE}/orders/${orderId}`);

    await expect(page.getByRole('button', { name: '주문 취소·환불' })).toBeVisible();
    await page.getByRole('button', { name: '재배송 준비로 돌리기' }).click();
    // 기상 보류는 고객 책임·재배송비가 없어 알림톡 없이 기사 수거 대기로 돌아간다.
    await expect(page.getByText('기사 화면 수거 대기로 돌아가요(알림톡 없음).')).toBeVisible();
    await page.getByRole('button', { name: '재배송 준비', exact: true }).click();

    await expect(page.getByRole('button', { name: '재배송 준비로 돌리기' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '배송 보류', exact: true })).toBeVisible();
  });

  test('기사가 가져가기 전 준비 중 주문을 판매자가 배송 보류한다', async ({ page, roundDirect }) => {
    const orderId = roundDirect.orderId(ORDER_FIXTURE_SUFFIXES.HOLD_PREPARING);
    await page.goto(`${BASE}/orders/${orderId}`);

    // 포장할 상품은 상품마다 한 줄로 보인다.
    await expect(page.getByText('E2E 호접란 × 1', { exact: true })).toBeVisible();
    await expect(page.getByText('E2E 미니 호접란 × 1', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '배송 보류', exact: true }).click();
    const holdDialog = page.getByRole('dialog', { name: '배송 보류' });
    await holdDialog.getByRole('radio', { name: '기타' }).check();
    await holdDialog.getByLabel('보류 사유').fill('포장 상태를 다시 확인해야 합니다.');
    // 고객 책임이면 재배송비가 있어야 저장할 수 있다.
    await holdDialog.getByRole('checkbox', { name: '고객 책임' }).check();
    await expect(holdDialog.getByText('고객 책임이면 재배송비를 입력해 주세요.')).toBeVisible();
    await expect(holdDialog.getByRole('button', { name: '보류 저장' })).toBeDisabled();
    await holdDialog.getByRole('checkbox', { name: '고객 책임' }).uncheck();
    await holdDialog.getByRole('button', { name: '보류 저장' }).click();

    await expect(holdDialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: '재배송 준비로 돌리기' })).toBeVisible();
  });
});
