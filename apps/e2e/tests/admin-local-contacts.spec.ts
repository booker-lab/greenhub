import { expect, test } from '@playwright/test';
import {
  ADMIN_LOCAL_SKIP_REASON,
  adminLocalEnabled,
  assertLocalRuntimeReady,
  createLocalAdmin,
  deleteDocs,
  deleteLocalAdmin,
  type LocalAdmin,
  loginLocalAdmin,
  newPhone,
  newRunId,
  openAdminPage,
  seedDocs,
  visible,
} from './_helpers/admin-local';

// 어드민 기사·판매자 탭의 연락처 표시(#593) — 배포 뒤 사람이 볼 확인 목록을 로컬에서 대신 본다.
// 실제 API + 에뮬레이터(pnpm dev:local)에 시드한 기사·판매자만 보고, 만든 문서는 afterAll에서 지운다.
test.describe('어드민 로컬 — 기사·판매자 연락처', () => {
  test.skip(!adminLocalEnabled(), ADMIN_LOCAL_SKIP_REASON);

  let admin: LocalAdmin | null = null;
  let runId = '';
  const created: string[] = [];
  const driver = { name: '', email: '', phone: '', joined: '2026-10-01' };
  const store = { name: '', ceoName: '연락처대표', phone: '' };

  test.beforeAll(async () => {
    await assertLocalRuntimeReady();
    runId = newRunId(test.info());
    admin = await createLocalAdmin(runId);
    driver.name = `연락처기사 ${runId}`;
    driver.email = `e2e-driver-${runId}@greenhub.local`;
    driver.phone = newPhone();
    store.phone = newPhone();
    store.name = `연락처농원 ${runId}`;
    const driverId = `e2e-adm-${runId}-driver`;
    const storeId = `e2e-adm-${runId}-store`;
    created.push(`users/${driverId}`, `stores/${storeId}`);
    await seedDocs([
      {
        path: `users/${driverId}`,
        data: {
          id: driverId,
          role: 'driver',
          name: driver.name,
          email: driver.email,
          phone: driver.phone,
          driverApproved: false,
          suspended: false,
          storeId: null,
          // KST 2026-10-01 정오 — 가입일 표기는 KST 날짜.
          createdAt: new Date('2026-10-01T03:00:00Z'),
        },
      },
      {
        path: `stores/${storeId}`,
        data: {
          id: storeId,
          name: store.name,
          ownerId: `e2e-adm-${runId}-owner`,
          status: 'active',
          commissionRate: null,
          ceoName: store.ceoName,
          phone: store.phone,
          createdAt: new Date(),
        },
      },
    ]);
  });

  test.afterAll(async () => {
    await deleteDocs(created);
    await deleteLocalAdmin(admin);
  });

  test.beforeEach(async ({ page }) => {
    await loginLocalAdmin(page, admin as LocalAdmin);
  });

  test('기사 승인 대기 상자 — 이름·전화(전화 걸기 링크)·신청일을 보여 준다', async ({ page }) => {
    await openAdminPage(page, '/admin/drivers', '활동 중');

    // 시드 기사는 미승인이라 표 위 승인 대기 상자(D7)에 보인다. 상자는 이메일 대신 연락처·신청일을 쓴다.
    const box = page.getByRole('region', { name: /승인 대기/ });
    const item = box.getByRole('listitem').filter({ hasText: driver.name });
    await expect(item).toHaveCount(1, { timeout: 30_000 });
    const phoneLink = item.locator(`a[href="tel:${driver.phone}"]`);
    await expect(phoneLink).toHaveCount(1);
    await expect(phoneLink).toHaveText(driver.phone);
    // 전화와 신청일은 같은 줄이다 — 다른 실행의 기사와 섞이지 않게 이 기사 항목 안에서 찾는다.
    await expect(item).toContainText(`${driver.phone} · 신청 ${driver.joined}`);
    await expect(item.getByRole('button', { name: `기사 ${driver.name} 승인` })).toBeVisible();
  });

  test('판매자 탭 — 대표자·연락처(전화 걸기 링크)를 보여 준다', async ({ page }) => {
    await openAdminPage(page, '/admin/stores', '이 목록에서 찾기');

    await page.getByLabel('이 목록에서 찾기').fill(store.name);
    await expect(visible(page.getByText(store.name))).toHaveCount(1, { timeout: 30_000 });
    await expect(visible(page.getByText(`${store.ceoName} ·`))).toHaveCount(1);
    const phoneLink = visible(page.locator(`a[href="tel:${store.phone}"]`));
    await expect(phoneLink).toHaveCount(1);
    await expect(phoneLink).toHaveText(store.phone);

    // 전화번호로도 같은 판매자를 찾는다(검색은 숫자만 비교).
    await page.getByLabel('이 목록에서 찾기').fill(store.phone.replace(/-/g, ''));
    await expect(visible(page.getByText(store.name))).toHaveCount(1);
  });
});
