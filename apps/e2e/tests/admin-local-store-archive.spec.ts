import { expect, type Page, test } from '@playwright/test';
import {
  ADMIN_LOCAL_API_BASE,
  ADMIN_LOCAL_SKIP_REASON,
  adminLocalEnabled,
  assertLocalRuntimeReady,
  createLocalAdmin,
  deleteDocs,
  deleteLocalAdmin,
  type LocalAdmin,
  loginLocalAdmin,
  newRunId,
  openAdminPage,
  readDoc,
  rowOrListItem,
  seedDocs,
} from './_helpers/admin-local';

// 어드민 판매자 정리하기(#593 결정 ③, ② D7에서 "치우기"→"정리하기") — 기록 없는 가게를 정리하면 손님 공개 API(가게 소개·회차·상품)가 404,
// 복구하면 다시 보인다. 실제 API + 에뮬레이터(pnpm dev:local)에서 이 spec 전용 가게로 본다.
test.describe('어드민 로컬 — 판매자 정리하기·복구', () => {
  test.skip(!adminLocalEnabled(), ADMIN_LOCAL_SKIP_REASON);

  let admin: LocalAdmin | null = null;
  const created: string[] = [];
  const fx = { storeId: '', storeName: '', productId: '', roundId: '' };

  test.beforeAll(async () => {
    await assertLocalRuntimeReady();
    const runId = newRunId(test.info());
    admin = await createLocalAdmin(runId);
    fx.storeId = `e2e-adm-${runId}-store`;
    fx.storeName = `치우기농원 ${runId}`;
    fx.productId = `e2e-adm-${runId}-product`;
    fx.roundId = `e2e-adm-${runId}-round`;
    const now = new Date();
    const day = 24 * 60 * 60 * 1000;
    const docs = [
      {
        path: `stores/${fx.storeId}`,
        data: {
          id: fx.storeId,
          name: fx.storeName,
          ownerId: `e2e-adm-${runId}-owner`,
          status: 'active',
          salesMode: 'round_direct',
          createdAt: now,
        },
      },
      {
        path: `products/${fx.productId}`,
        data: {
          id: fx.productId,
          storeId: fx.storeId,
          name: `치우기 상품 ${runId}`,
          price: 15_000,
          saleType: 'normal',
          isActive: true,
          images: [],
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        // 지난(완료) 회차 — 공개 회차 목록·상세에 보이는 상태.
        path: `saleRounds/${fx.roundId}`,
        data: {
          id: fx.roundId,
          storeId: fx.storeId,
          name: `치우기 회차 ${runId}`,
          status: 'COMPLETED',
          closeReason: 'MANUAL',
          cancellation: null,
          schedule: {
            orderOpenAt: new Date(now.getTime() - 7 * day).toISOString(),
            orderCloseAt: new Date(now.getTime() - 3 * day).toISOString(),
            auctionAt: new Date(now.getTime() - 2 * day).toISOString(),
            deliveryStartAt: new Date(now.getTime() - day).toISOString(),
            deliveryEndAt: new Date(now.getTime() - day + 9 * 60 * 60 * 1000).toISOString(),
            timezone: 'Asia/Seoul',
          },
          deliveryRegion: {
            id: 'icheon',
            label: '경기도 이천시',
            province: '경기도',
            city: '이천시',
            enabled: true,
          },
          limits: { maxDeliveryAddresses: 100, maxItemQuantity: 300 },
          counters: {
            reservedDeliveryAddresses: 0,
            reservedItemQuantity: 0,
            orderedDeliveryAddresses: 0,
            orderedItemQuantity: 0,
            heldOrderCount: 0,
          },
          carrotLandingUrl: null,
          cancelledAt: null,
          completedAt: now.toISOString(),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      },
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

  // 치우기·복구 뒤 목록 재조회는 병렬 실행(next dev) 부하에서 기본 5초를 넘길 수 있어 15초까지 기다린다.
  // 손님(비로그인)이 부르는 공개 API — 가게 소개·회차 목록·회차 상세·가게 상품 목록·상품 상세(가게·전체).
  const publicPaths = () => [
    `/stores/${fx.storeId}/public-profile`,
    `/stores/${fx.storeId}/sale-rounds/public`,
    `/stores/${fx.storeId}/sale-rounds/public/${fx.roundId}`,
    `/stores/${fx.storeId}/products`,
    `/stores/${fx.storeId}/products/${fx.productId}`,
    `/products/${fx.productId}`,
  ];
  async function publicStatuses(): Promise<Record<string, number>> {
    const entries = await Promise.all(
      publicPaths().map(async (path) => {
        const res = await fetch(`${ADMIN_LOCAL_API_BASE}${path}`);
        return [path, res.status] as const;
      }),
    );
    return Object.fromEntries(entries);
  }
  const allStatuses = (status: number) =>
    Object.fromEntries(publicPaths().map((path) => [path, status]));

  const storeRow = (page: Page) =>
    rowOrListItem(page).filter({
      has: page.getByText(fx.storeName, { exact: true }),
    });

  /**
   * 행 끝 ⋮ 메뉴 항목을 눌러 확인창(② D7, 제목 = 동작 + 대상)을 열고, 확인창 글자를 받아 둔 뒤 확정하고
   * 해당 PATCH 응답을 기다린다.
   */
  async function confirmRowAction(
    page: Page,
    menuItem: string,
    action: 'archive' | 'restore',
    dialogTitle: string,
    confirmLabel: string,
  ) {
    await storeRow(page)
      .getByRole('button', { name: `판매자 ${fx.storeName} 동작 더 보기`, exact: true })
      .click();
    await page.getByRole('menuitem', { name: menuItem, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: dialogTitle });
    await expect(dialog).toBeVisible();
    const confirmMessage = (await dialog.textContent()) ?? '';
    const response = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/admin/stores/${fx.storeId}/${action}`) &&
        res.request().method() === 'PATCH',
    );
    await dialog.getByRole('button', { name: confirmLabel, exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(dialog).toBeHidden();
    return confirmMessage;
  }

  test('정리하면 손님 공개 API가 404, 복구하면 다시 200이다', async ({ page }) => {
    // 시드 직후 — 손님에게 보인다.
    expect(await publicStatuses()).toEqual(allStatuses(200));
    const products = (await (
      await fetch(`${ADMIN_LOCAL_API_BASE}/stores/${fx.storeId}/products`)
    ).json()) as { items: Array<{ id: string }> };
    expect(products.items.map((item) => item.id)).toContain(fx.productId);

    await openAdminPage(page, '/admin/stores', '이 목록에서 찾기');
    await page.getByLabel('이 목록에서 찾기').fill(fx.storeName);
    await expect(storeRow(page)).toHaveCount(1, { timeout: 30_000 });

    const archiveMessage = await confirmRowAction(
      page,
      '정리하기…',
      'archive',
      `${fx.storeName} 판매자 정리하기`,
      `${fx.storeName} 정리하기`,
    );
    expect(archiveMessage).toContain('손님 화면에서 가게와 상품이 숨고 새 주문을 받지 않습니다.');
    expect(archiveMessage).toContain(
      '주문·정산 기록이 있는 판매자는 가게 ID 앞 8자리를 한 번 더 입력해야 정리됩니다.',
    );
    // 기본 보기(운영·초대)에서는 정리한 판매자가 빠진다.
    await expect(page.getByText('조건에 맞는 판매자가 없습니다.')).toBeVisible({ timeout: 15_000 });
    expect((await readDoc(`stores/${fx.storeId}`))?.status).toBe('archived');
    expect(await publicStatuses()).toEqual(allStatuses(404));

    // 상태 탭을 '전체'로 바꾸면 '정리됨'으로 보이고 복구할 수 있다.
    await page
      .getByRole('group', { name: '판매자 상태' })
      .getByRole('button', { name: /^전체/ })
      .click();
    await expect(storeRow(page)).toContainText('정리됨', { timeout: 15_000 });
    const restoreMessage = await confirmRowAction(
      page,
      '복구하기…',
      'restore',
      `${fx.storeName} 판매자 복구`,
      `${fx.storeName} 복구`,
    );
    expect(restoreMessage).toContain('복구하면 손님 화면에 다시 보이고 새 주문을 받습니다.');
    await expect(storeRow(page)).toContainText('운영 중', { timeout: 15_000 });
    const restored = await readDoc(`stores/${fx.storeId}`);
    expect(restored?.status).toBe('active');
    expect(restored?.archivedAt).toBeUndefined();
    expect(await publicStatuses()).toEqual(allStatuses(200));
  });
});
