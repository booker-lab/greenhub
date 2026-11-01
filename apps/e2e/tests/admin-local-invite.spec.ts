import { expect, type Page, test } from '@playwright/test';
import {
  ADMIN_LOCAL_SELLER_BASE,
  ADMIN_LOCAL_SKIP_REASON,
  adminLocalEnabled,
  assertLocalRuntimeReady,
  createLocalAdmin,
  deleteDocs,
  deleteLocalAdmin,
  findDocPaths,
  type LocalAdmin,
  loginLocalAdmin,
  newRunId,
  openAdminPage,
  readDoc,
  rowOrListItem,
} from './_helpers/admin-local';

// 어드민 판매자 초대(#589) — 발급한 초대의 복사 값이 토큰이 아니라 `/invite/<토큰>` 링크이고,
// 발급 내역에 발급 일시(KST)가 보이는지 실제 API + 에뮬레이터(pnpm dev:local)에서 본다.
// 카카오 로그인으로 가입하는 나머지 흐름은 로컬 E2E로 열 수 없어 API 통합 테스트가 덮는다(apps/e2e/README.md).

// 화면(invite/_lib formatKstDateTime)과 같은 표기.
// 어드민 날짜 표기(design-direction.md §5 "날짜") — 한국 시간 "2026-11-01 09:00".
const KST_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const KST_DATE_TIME = {
  format(date: Date): string {
    const p = Object.fromEntries(KST_PARTS.formatToParts(date).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  },
};

declare global {
  interface Window {
    __e2eCopied?: string[];
  }
}

test.describe('어드민 로컬 — 판매자 초대', () => {
  test.skip(!adminLocalEnabled(), ADMIN_LOCAL_SKIP_REASON);

  let admin: LocalAdmin | null = null;
  let recipientEmail = '';

  test.beforeAll(async () => {
    await assertLocalRuntimeReady();
    const runId = newRunId(test.info());
    admin = await createLocalAdmin(runId);
    recipientEmail = `e2e-invite-${runId}@greenhub.local`;
  });

  test.afterAll(async () => {
    // 이번 실행이 발급한 초대는 받는 사람 이메일로 찾는다(발급 도중 실패해도 남기지 않는다).
    if (recipientEmail)
      await deleteDocs(await findDocPaths('invites', 'recipientEmail', recipientEmail));
    await deleteLocalAdmin(admin);
  });

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: ADMIN_LOCAL_SELLER_BASE,
    });
    // 앱이 클립보드에 넘긴 값을 그대로 기록한다(동시에 도는 다른 브라우저와 OS 클립보드를 공유하지 않게).
    await page.addInitScript(() => {
      const clipboard = navigator.clipboard;
      if (!clipboard) return;
      const writeText = clipboard.writeText.bind(clipboard);
      window.__e2eCopied = [];
      clipboard.writeText = (text: string) => {
        window.__e2eCopied?.push(text);
        return writeText(text);
      };
    });
    await loginLocalAdmin(page, admin as LocalAdmin);
  });

  const copiedValues = (page: Page) => page.evaluate(() => window.__e2eCopied ?? []);

  test('발급 직후·발급 내역 복사 값은 /invite/<토큰> 링크이고, 내역에 발급 일시가 보인다', async ({
    page,
  }) => {
    await openAdminPage(page, '/admin/invite', '판매자 초대 링크');

    await page.getByLabel('받는 사람 이메일').fill(recipientEmail);
    const issued = page.waitForResponse(
      (res) => res.url().endsWith('/admin/invite') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '새 초대 링크 만들기' }).click();
    const response = await issued;
    expect(response.status()).toBe(201);
    const { token } = (await response.json()) as { token: string };
    expect(token).toMatch(/^[0-9A-F]{16}$/);
    const link = `${ADMIN_LOCAL_SELLER_BASE}/invite/${token}`;

    // 발급 직후 카드 — 링크를 보여 주고, 복사하면 링크가 들어간다.
    await expect(page.getByText(link, { exact: true })).toBeVisible();
    await expect(page.getByText(`받는 사람: ${recipientEmail}`)).toBeVisible();
    await page.getByRole('button', { name: '링크 복사', exact: true }).click();
    await expect(page.getByRole('button', { name: '복사됨!', exact: true }).first()).toBeVisible();
    expect(await copiedValues(page)).toEqual([link]);

    // 발급 내역 — 같은 토큰 행에 발급 일시(KST)와 유효 상태, 행 복사도 링크.
    const stored = await readDoc(`invites/${token}`);
    const issuedAt = KST_DATE_TIME.format(new Date(String(stored?.createdAt)));
    const row = rowOrListItem(page).filter({ has: page.getByText(token, { exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(issuedAt);
    await expect(row).toContainText('유효');
    await row.getByRole('button', { name: `토큰 ${token} 초대 링크 복사` }).click();
    await expect.poll(() => copiedValues(page)).toEqual([link, link]);
  });
});
