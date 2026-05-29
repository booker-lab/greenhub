import { expect, type Page, test } from '@playwright/test';
import { ADMIN_STATE_PATH } from './_helpers/auth';

const BASE = process.env.SELLER_BASE ?? 'https://seller.greenlove.co.kr';

const adminEmail = process.env.TEST_ADMIN_EMAIL;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
const skipAuth = !adminEmail || !adminPassword;

const VALID_TOKEN = 'INVITEVALID00001';
const USED_TOKEN = 'INVITEUSED000001';
const EXPIRED_TOKEN = 'INVITEEXPIRED001';

type InviteFixture = {
  token: string;
  createdBy: string;
  usedAt: string | null;
  usedBy: string | null;
  revokedAt?: string | null;
  revokedBy?: string | null;
  expiresAt: string | null;
  createdAt: string | null;
};

interface InviteMockState {
  invites: InviteFixture[];
  revokeRequests: string[];
  failNextRevokeReason?: 'already_used' | 'already_revoked' | 'expired';
}

function createInviteFixture(): InviteFixture[] {
  return [
    {
      token: VALID_TOKEN,
      createdBy: 'admin-1',
      usedAt: null,
      usedBy: null,
      revokedAt: null,
      revokedBy: null,
      expiresAt: '2099-05-29T03:00:00.000Z',
      createdAt: '2026-05-29T01:00:00.000Z',
    },
    {
      token: USED_TOKEN,
      createdBy: 'admin-1',
      usedAt: '2026-05-29T02:00:00.000Z',
      usedBy: 'seller-1',
      revokedAt: null,
      revokedBy: null,
      expiresAt: '2099-05-29T03:00:00.000Z',
      createdAt: '2026-05-29T00:30:00.000Z',
    },
    {
      token: EXPIRED_TOKEN,
      createdBy: 'admin-1',
      usedAt: null,
      usedBy: null,
      revokedAt: null,
      revokedBy: null,
      expiresAt: '2026-05-01T03:00:00.000Z',
      createdAt: '2026-04-24T03:00:00.000Z',
    },
  ];
}

async function installInviteApiFixture(page: Page): Promise<InviteMockState> {
  const state: InviteMockState = { invites: createInviteFixture(), revokeRequests: [] };

  await page.route('**/admin/invite**', async (route) => {
    const request = route.request();
    if (request.resourceType() === 'document') {
      await route.continue();
      return;
    }

    const url = new URL(request.url());
    const revokeMatch = url.pathname.match(/\/admin\/invite\/([^/]+)\/revoke$/);

    if (request.method() === 'GET' && url.pathname.endsWith('/admin/invite')) {
      const q = url.searchParams.get('q') ?? '';
      const body =
        q.length >= 4
          ? state.invites.filter((invite) => invite.token.startsWith(q))
          : state.invites;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
      return;
    }

    if (request.method() === 'POST' && revokeMatch) {
      const token = revokeMatch[1];
      state.revokeRequests.push(token);

      if (state.failNextRevokeReason) {
        const reason = state.failNextRevokeReason;
        state.failNextRevokeReason = undefined;
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ reason, message: '초대 토큰을 취소할 수 없습니다.' }),
        });
        return;
      }

      state.invites = state.invites.map((invite) =>
        invite.token === token
          ? { ...invite, revokedAt: '2026-05-29T03:00:00.000Z', revokedBy: 'admin-1' }
          : invite,
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.continue();
  });

  return state;
}

async function openInvite(page: Page): Promise<InviteMockState> {
  const state = await installInviteApiFixture(page);
  await page.goto(`${BASE}/admin/invite`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('초대 토큰 발급')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: `${VALID_TOKEN} 복사` })).toBeVisible({
    timeout: 15_000,
  });
  return state;
}

test.describe('Admin - 초대 토큰 취소 회귀', () => {
  test.use({ storageState: ADMIN_STATE_PATH });
  test.skip(skipAuth, 'TEST_ADMIN_EMAIL/PASSWORD 미설정 - 어드민 인증 검증을 건너뜁니다');

  test('유효 토큰만 취소 버튼을 노출하고 취소 후 취소됨 상태로 갱신한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const state = await openInvite(page);

    await expect(page.getByRole('button', { name: `${VALID_TOKEN} 취소` })).toBeVisible();
    await expect(page.getByRole('button', { name: `${USED_TOKEN} 취소` })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `${EXPIRED_TOKEN} 취소` })).toHaveCount(0);

    await page.getByRole('button', { name: `${VALID_TOKEN} 취소` }).click();
    await expect(page.getByText(`토큰 ${VALID_TOKEN} 을 취소하시겠습니까?`)).toBeVisible();
    await expect(page.getByText('취소 후에는 이 토큰으로 가입할 수 없습니다.')).toBeVisible();
    await page.getByRole('button', { name: '취소', exact: true }).last().click();

    await expect.poll(() => state.revokeRequests).toContainEqual(VALID_TOKEN);
    await expect(page.locator('table')).toContainText('취소됨');
    await expect(page.getByRole('button', { name: `${VALID_TOKEN} 취소` })).toHaveCount(0);
  });

  test('이미 취소된 reason 응답은 사용자 알림으로 드러낸다', async ({ page }) => {
    const state = await openInvite(page);
    state.failNextRevokeReason = 'already_revoked';

    await page.getByRole('button', { name: `${VALID_TOKEN} 취소` }).click();
    await page.getByRole('button', { name: '취소', exact: true }).last().click();

    await expect.poll(() => state.revokeRequests).toContainEqual(VALID_TOKEN);
    await expect(page.getByText('이미 취소된 토큰입니다.')).toBeVisible();
  });

  test('4자 prefix 검색은 취소 UI와 함께 동작한다', async ({ page }) => {
    await openInvite(page);

    await page.getByLabel('초대 토큰 검색').fill('INVITEVALID');
    await expect(page.getByRole('button', { name: `${VALID_TOKEN} 복사` })).toBeVisible();
    await expect(page.getByRole('button', { name: `${USED_TOKEN} 복사` })).toHaveCount(0);

    await page.getByLabel('초대 토큰 검색').fill('NOPE');
    await expect(page.getByText('일치하는 토큰이 없습니다.')).toBeVisible();

    await page.getByLabel('초대 토큰 검색').fill('');
    await expect(page.getByRole('button', { name: `${VALID_TOKEN} 복사` })).toBeVisible();
    await expect(page.getByRole('button', { name: `${USED_TOKEN} 복사` })).toBeVisible();
  });
});
