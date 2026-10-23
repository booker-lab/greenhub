import { expect, type Page, test } from '@playwright/test';
import {
  ADMIN_LOCAL_SKIP_REASON,
  adminLocalEnabled,
  assertLocalRuntimeReady,
  createLocalAdmin,
  type DocData,
  deleteDocs,
  deleteLocalAdmin,
  krw,
  type LocalAdmin,
  loginLocalAdmin,
  newRunId,
  openAdminPage,
  pickSelectOption,
  readDoc,
  seedDocs,
  visible,
} from './_helpers/admin-local';

// 어드민 정산(#592) — 상태 필터·지급 대기/지급 완료 합계 카드·더 보기·지급 확인창(가게·금액·계좌)·지급 뒤 합계 이동.
// 실제 API + 에뮬레이터(pnpm dev:local)에서 이 spec 전용 가게 하나의 정산 101건으로 본다(한 쪽 100건 + 1).
const FILLER_COUNT = 99;
const PAY = { net: 45_000, fee: 5_000 };
const PAID = { net: 18_000, fee: 2_000 };
const FILLER = { net: 1_000, fee: 100 };

test.describe('어드민 로컬 — 정산', () => {
  test.skip(!adminLocalEnabled(), ADMIN_LOCAL_SKIP_REASON);

  let admin: LocalAdmin | null = null;
  const created: string[] = [];
  const fx = {
    storeName: '',
    payId: '',
    payOrderNumber: '',
    paidOrderNumber: '',
    orderPrefix: '',
    account: { bankName: '농협은행', accountHolder: '', accountNumber: '' },
  };

  test.beforeAll(async () => {
    await assertLocalRuntimeReady();
    const runId = newRunId(test.info());
    admin = await createLocalAdmin(runId);
    const storeId = `e2e-adm-${runId}-store`;
    fx.storeName = `정산농원 ${runId}`;
    fx.orderPrefix = `E2E-${runId}-`;
    fx.payId = `e2e-adm-${runId}-pay`;
    fx.payOrderNumber = `${fx.orderPrefix}PAY`;
    fx.paidOrderNumber = `${fx.orderPrefix}PAID`;
    fx.account.accountHolder = `예금주${runId}`;
    fx.account.accountNumber = `302-${runId.slice(1, 5)}-0000-11`;

    const now = Date.now();
    const settlement = (
      id: string,
      orderNumber: string,
      status: string,
      amounts: { net: number; fee: number },
      minutesAgo: number,
    ): { path: string; data: DocData } => ({
      path: `settlements/${id}`,
      data: {
        id,
        storeId,
        orderId: `${id}-order`,
        orderNumber,
        status,
        totalAmount: amounts.net + amounts.fee,
        platformFee: amounts.fee,
        netAmount: amounts.net,
        settledAt: new Date(now - minutesAgo * 60_000),
        createdAt: new Date(now - minutesAgo * 60_000),
      },
    });
    const docs = [
      {
        path: `stores/${storeId}`,
        data: {
          id: storeId,
          name: fx.storeName,
          ownerId: `e2e-adm-${runId}-owner`,
          status: 'active',
          createdAt: new Date(now),
        },
      },
      { path: `storePayoutAccounts/${storeId}`, data: { storeId, ...fx.account } },
      settlement(fx.payId, fx.payOrderNumber, 'confirmed', PAY, 1),
      // 지급은 정산의 주문이 있고 취소·환불 중이 아닐 때만 된다(#603) — 지급 대상만 배송 완료 주문을 둔다.
      {
        path: `orders/${fx.payId}-order`,
        data: {
          id: `${fx.payId}-order`,
          storeId,
          orderNumber: fx.payOrderNumber,
          status: 'DELIVERED',
          totalAmount: PAY.net + PAY.fee,
          createdAt: new Date(now - 60 * 60_000),
        },
      },
      settlement(`e2e-adm-${runId}-paid`, fx.paidOrderNumber, 'paid', PAID, 2),
      ...Array.from({ length: FILLER_COUNT }, (_, i) => {
        const n = String(i + 1).padStart(3, '0');
        return settlement(
          `e2e-adm-${runId}-f${n}`,
          `${fx.orderPrefix}F${n}`,
          'pending',
          FILLER,
          3 + i,
        );
      }),
    ];
    created.push(...docs.map((doc) => doc.path));
    await seedDocs(docs);
  });

  test.afterAll(async () => {
    await deleteDocs(created);
    await deleteLocalAdmin(admin);
  });

  test.beforeEach(async ({ page }) => {
    await loginLocalAdmin(page, admin as LocalAdmin);
  });

  const rows = (page: Page) =>
    visible(page.getByText(new RegExp(`^${fx.orderPrefix}`), { exact: true }));
  // 합계 카드는 '플랫폼 수수료' 카드가 있는 묶음 안에서만 찾는다(목록 카드의 상태 배지와 섞이지 않게).
  const summaryCard = (page: Page, label: string) => {
    const grid = visible(page.locator('.mantine-SimpleGrid-root')).filter({
      has: page.getByText('플랫폼 수수료', { exact: true }),
    });
    return grid.locator('.mantine-Paper-root').filter({
      has: page.getByText(label, { exact: true }),
    });
  };
  const statusTab = (page: Page, label: string) =>
    visible(page.getByRole('button', { name: label, exact: true }));

  async function openStoreSettlements(page: Page) {
    await openAdminPage(page, '/admin/settlements', '정산 목록');
    await pickSelectOption(
      page,
      page.getByRole('combobox', { name: '가게', exact: true }),
      fx.storeName,
      {
        search: true,
      },
    );
    await expect(page.getByText('정산 목록 (101)')).toBeVisible({ timeout: 30_000 });
  }

  test('합계 카드는 조건 전체, 목록은 100건 뒤 더 보기로 이어 받는다', async ({ page }) => {
    await openStoreSettlements(page);

    await expect(summaryCard(page, '지급 대기')).toContainText(krw(PAY.net));
    await expect(summaryCard(page, '지급 대기')).toContainText('1건 · 확정');
    await expect(summaryCard(page, '지급 완료')).toContainText(krw(PAID.net));
    await expect(summaryCard(page, '지급 완료')).toContainText('1건');
    await expect(summaryCard(page, '플랫폼 수수료')).toContainText(krw(PAY.fee + PAID.fee));

    await expect(rows(page)).toHaveCount(100);
    await expect(
      page.getByText('100건까지 불러왔습니다. 합계 카드는 조건 전체 기준입니다.'),
    ).toBeVisible();
    await visible(page.getByRole('button', { name: '더 보기' })).click();
    await expect(rows(page)).toHaveCount(101);
    await expect(page.getByRole('button', { name: '더 보기' })).toHaveCount(0);
    // 더 받아도 합계는 그대로다(서버가 조건 전체로 계산).
    await expect(summaryCard(page, '지급 대기')).toContainText(krw(PAY.net));
  });

  test('상태 필터 — 확정·지급 완료·전체로 목록과 건수가 바뀐다', async ({ page }) => {
    await openStoreSettlements(page);

    await statusTab(page, '확정').click();
    await expect(page.getByText('정산 목록 (1)')).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toHaveText(fx.payOrderNumber);

    await statusTab(page, '지급 완료').click();
    await expect(page.getByText('정산 목록 (1)')).toBeVisible();
    await expect(rows(page)).toHaveText(fx.paidOrderNumber);

    await statusTab(page, '정산 대기').click();
    await expect(page.getByText(`정산 목록 (${FILLER_COUNT})`)).toBeVisible();
    await expect(rows(page)).toHaveCount(FILLER_COUNT);

    await statusTab(page, '전체').click();
    await expect(page.getByText('정산 목록 (101)')).toBeVisible();
  });

  test('지급 확인창에 가게·주문·금액·계좌를 보이고, 지급하면 합계가 지급 완료로 옮겨 간다', async ({
    page,
  }) => {
    await openStoreSettlements(page);
    await statusTab(page, '확정').click();
    await expect(page.getByText('정산 목록 (1)')).toBeVisible();
    await expect(rows(page)).toHaveText(fx.payOrderNumber);

    await visible(page.getByRole('button', { name: '지급처리' })).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('정산 지급 처리')).toBeVisible();
    await expect(dialog).toContainText(`가게: ${fx.storeName}`);
    await expect(dialog).toContainText(`주문번호: ${fx.payOrderNumber}`);
    await expect(dialog).toContainText(`지급액: ${krw(PAY.net)}`);
    const { bankName, accountNumber, accountHolder } = fx.account;
    await expect(dialog).toContainText(
      `입금 계좌: ${bankName} ${accountNumber} (예금주 ${accountHolder})`,
    );

    const payResponse = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/admin/settlements/${fx.payId}/pay`) &&
        res.request().method() === 'PATCH',
    );
    await dialog.getByRole('button', { name: '지급 완료', exact: true }).click();
    expect((await payResponse).status()).toBe(200);
    await expect(dialog).toBeHidden();
    expect((await readDoc(`settlements/${fx.payId}`))?.status).toBe('paid');

    await statusTab(page, '전체').click();
    await expect(summaryCard(page, '지급 대기')).toContainText(krw(0));
    await expect(summaryCard(page, '지급 대기')).toContainText('0건 · 확정');
    await expect(summaryCard(page, '지급 완료')).toContainText(krw(PAY.net + PAID.net));
    await expect(summaryCard(page, '지급 완료')).toContainText('2건');
    // 수수료 합계는 지급 대기 + 지급 완료라 지급해도 변하지 않는다.
    await expect(summaryCard(page, '플랫폼 수수료')).toContainText(krw(PAY.fee + PAID.fee));
  });
});
