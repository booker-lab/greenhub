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
  rowOrListItem,
  seedDocs,
  visible,
  won,
} from './_helpers/admin-local';

// 어드민 주문(#593·#576) — 목록 칸(주문일시·고객·상품·가게)·가게 이름 Select·더 보기·강제환불 확인창.
// 실제 API + 에뮬레이터(pnpm dev:local)에서 이 spec 전용 가게의 주문 51건(한 쪽 50건 + 1)으로 본다.
// 강제환불은 확인창까지만 열고 취소한다 — 환불 요청이 나가지 않는 것까지 확인한다.
const FILLER_COUNT = 49;

test.describe('어드민 로컬 — 주문', () => {
  test.skip(!adminLocalEnabled(), ADMIN_LOCAL_SKIP_REASON);

  let admin: LocalAdmin | null = null;
  const created: string[] = [];
  const fx = {
    storeName: '',
    orderPrefix: '',
    refund: { id: '', orderNumber: '', buyerName: '', productName: '', amount: 32_000 },
    round: { orderNumber: '', firstProduct: '' },
  };

  test.beforeAll(async () => {
    await assertLocalRuntimeReady();
    const runId = newRunId(test.info());
    admin = await createLocalAdmin(runId);
    const storeId = `e2e-adm-${runId}-store`;
    fx.storeName = `주문농원 ${runId}`;
    fx.orderPrefix = `E2E-${runId}-`;
    fx.refund = {
      id: `e2e-adm-${runId}-refund`,
      orderNumber: `${fx.orderPrefix}RF`,
      buyerName: `김주문${runId}`,
      productName: `호접란 ${runId}`,
      amount: 32_000,
    };
    fx.round = { orderNumber: `${fx.orderPrefix}RD`, firstProduct: `춘란 ${runId}` };

    const order = (id: string, data: DocData): { path: string; data: DocData } => ({
      path: `orders/${id}`,
      data: { id, storeId, deliveryMethod: 'direct', ...data },
    });
    const docs = [
      {
        path: `stores/${storeId}`,
        data: {
          id: storeId,
          name: fx.storeName,
          ownerId: `e2e-adm-${runId}-owner`,
          status: 'active',
          createdAt: new Date(),
        },
      },
      // 일반 주문(접수됨) — 강제환불 버튼이 보이는 상태. KST 2026-10-20 12:04 주문.
      order(fx.refund.id, {
        orderNumber: fx.refund.orderNumber,
        status: 'ACCEPTED',
        totalAmount: fx.refund.amount,
        buyerName: fx.refund.buyerName,
        productName: fx.refund.productName,
        createdAt: new Date('2026-10-20T03:04:00Z'),
      }),
      // 회차 주문 — 상품 여러 개는 "첫 상품 외 N개"로 줄인다.
      order(`e2e-adm-${runId}-round`, {
        orderNumber: fx.round.orderNumber,
        schemaVersion: 2,
        roundId: `e2e-adm-${runId}-round-r1`,
        status: 'PREPARING',
        totalAmount: 54_000,
        buyerName: `이회차${runId}`,
        orderItems: [
          { productName: fx.round.firstProduct, quantity: 1 },
          { productName: `한란 ${runId}`, quantity: 2 },
        ],
        createdAt: new Date('2026-10-19T03:00:00Z'),
      }),
      ...Array.from({ length: FILLER_COUNT }, (_, i) => {
        const n = String(i + 1).padStart(2, '0');
        return order(`e2e-adm-${runId}-f${n}`, {
          orderNumber: `${fx.orderPrefix}F${n}`,
          status: 'DELIVERED',
          totalAmount: 10_000,
          buyerName: `채움${n}`,
          productName: `채움 상품 ${n}`,
          createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0) - i * 60_000),
        });
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

  const maskName = (name: string) => {
    const chars = Array.from(name);
    return chars.length <= 2
      ? `${chars[0]}*`
      : `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
  };
  const orderNumbers = (page: Page) =>
    visible(page.getByText(new RegExp(`^${fx.orderPrefix}`), { exact: true }));
  // 데스크톱은 표의 행, 모바일은 카드 — 주문번호로 한 줄을 집는다.
  const orderRow = (page: Page, orderNumber: string) =>
    rowOrListItem(page).filter({
      has: page.getByText(orderNumber, { exact: true }),
    });

  async function openStoreOrders(page: Page) {
    await openAdminPage(page, '/admin/orders', '전체 가게');
    await pickSelectOption(
      page,
      page.getByRole('combobox', { name: '가게 선택', exact: true }),
      fx.storeName,
      { search: true },
    );
    await expect(page.getByText('불러온 50건 · 더 있음')).toBeVisible({ timeout: 30_000 });
  }

  test('가게 이름으로 고르면 그 가게 주문만, 50건 뒤 더 보기로 이어 받는다', async ({ page }) => {
    await openStoreOrders(page);

    await expect(orderNumbers(page)).toHaveCount(50);
    await visible(page.getByRole('button', { name: '더 보기' })).click();
    await expect(page.getByText('불러온 51건', { exact: false })).toBeVisible();
    await expect(page.getByText('더 있음')).toHaveCount(0);
    await expect(orderNumbers(page)).toHaveCount(51);
    await expect(page.getByRole('button', { name: '더 보기' })).toHaveCount(0);
  });

  test('목록 칸 — 주문 시각·주문번호·가린 고객 이름·상품·가게 이름·금액을 보여 준다', async ({
    page,
  }) => {
    await openStoreOrders(page);

    const row = orderRow(page, fx.refund.orderNumber);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('2026-10-20 12:04');
    // 목록은 개인정보를 가린다(첫 글자와 끝 글자만, design-direction.md §5 어드민 "식별").
    await expect(row).toContainText(maskName(fx.refund.buyerName));
    await expect(row).not.toContainText(fx.refund.buyerName);
    await expect(row).toContainText(fx.refund.productName);
    await expect(row).toContainText(fx.storeName);
    await expect(row).toContainText('접수됨');
    await expect(row).toContainText(won(fx.refund.amount));

    const roundRow = orderRow(page, fx.round.orderNumber);
    await expect(roundRow).toContainText(`${fx.round.firstProduct} 외 1개`);
  });

  test('강제환불 확인창 — 주문번호·금액·되돌릴 수 없음을 보이고, 취소하면 요청하지 않는다', async ({
    page,
  }) => {
    const refundRequests: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/admin\/orders\/[^/]+\/refund$/.test(request.url())) {
        refundRequests.push(request.url());
      }
    });
    await openStoreOrders(page);

    // 정상 주문의 환불은 행 끝 ⋮ 메뉴 안에 있다(처리가 필요한 배송 보류 행만 보이는 "환불" 글자 버튼).
    await orderRow(page, fx.refund.orderNumber)
      .getByRole('button', { name: `주문 ${fx.refund.orderNumber} 동작 더 보기` })
      .click();
    await page.getByRole('menuitem', { name: '환불…' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('강제환불', { exact: true })).toBeVisible();
    await expect(dialog).toContainText(`주문번호 ${fx.refund.orderNumber}`);
    await expect(dialog).toContainText(`환불 금액 ${krw(fx.refund.amount)} (결제 금액 전액)`);
    await expect(dialog).toContainText('결제한 금액 전액을 바로 환불합니다. 되돌릴 수 없습니다.');
    await expect(dialog.getByRole('button', { name: '전액 환불' })).toBeVisible();

    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).toBeHidden();
    // 목록을 다시 받아도 주문은 그대로다(확인창 취소는 서버에 아무것도 보내지 않는다).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('전체 가게').first()).toBeVisible({ timeout: 30_000 });
    expect(refundRequests).toEqual([]);
    const stored = await readDoc(`orders/${fx.refund.id}`);
    expect(stored?.status).toBe('ACCEPTED');
    expect(stored?.cancellation).toBeUndefined();
  });
});
