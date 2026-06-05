import { expect, type Page, test } from '@playwright/test';
import { installInviteApiFixture, USED_TOKEN, VALID_TOKEN } from './_helpers/admin-invite-runtime';
import { ADMIN_STATE_PATH } from './_helpers/auth';
import {
  expectAdminTableSwitchAtSm,
  expectNoHorizontalOverflow,
  setMobileViewport,
} from './_helpers/responsive';

const BASE = process.env.SELLER_BASE ?? 'https://seller.greenlove.co.kr';

const adminEmail = process.env.TEST_ADMIN_EMAIL;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
const skipAuth = !adminEmail || !adminPassword;

async function installClipboardProbe(page: Page) {
  await page.addInitScript(() => {
    const target = window as typeof window & {
      __clipboardShouldFail?: boolean;
      __execCommandShouldFail?: boolean;
      __copiedTokens?: string[];
    };
    target.__copiedTokens = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          if (target.__clipboardShouldFail) throw new Error('clipboard blocked');
          target.__copiedTokens?.push(value);
        },
      },
    });
    document.execCommand = () => {
      if (target.__execCommandShouldFail) return false;
      const textarea = document.querySelector('textarea');
      if (textarea) target.__copiedTokens?.push(textarea.value);
      return true;
    };
  });
}

async function openInvite(page: Page): Promise<InviteMockState> {
  await installClipboardProbe(page);
  const state = await installInviteApiFixture(page);
  await page.goto(`${BASE}/admin/invite`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('초대 토큰 발급')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: `${VALID_TOKEN} 복사` })).toBeVisible({
    timeout: 15_000,
  });
  return state;
}

async function copiedTokens(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as typeof window & { __copiedTokens?: string[] }).__copiedTokens ?? [],
  );
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
    await expect(
      page.getByRole('button', { name: `${USED_TOKEN} 가입 판매자 되돌리기` }),
    ).toBeVisible();

    await page.getByRole('button', { name: `${VALID_TOKEN} 취소` }).click();
    await expect(page.getByText(`토큰 ${VALID_TOKEN} 을 취소하시겠습니까?`)).toBeVisible();
    await expect(page.getByText('취소 후에는 이 토큰으로 가입할 수 없습니다.')).toBeVisible();
    await page.getByRole('button', { name: '취소', exact: true }).last().click();

    await expect.poll(() => state.revokeRequests).toContainEqual(VALID_TOKEN);
    await expect(page.locator('table')).toContainText('취소됨');
    await expect(page.getByRole('button', { name: `${VALID_TOKEN} 취소` })).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('table')).toContainText('취소됨');
    await expect(page.getByRole('button', { name: `${VALID_TOKEN} 취소` })).toHaveCount(0);
  });

  test('사용된 토큰은 가입 판매자 되돌리기 후 되돌림 상태로 갱신한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const state = await openInvite(page);

    await expect(
      page.getByRole('button', { name: `${VALID_TOKEN} 가입 판매자 되돌리기` }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: `${USED_TOKEN} 가입 판매자 되돌리기` }).click();
    await expect(
      page.getByText(`토큰 ${USED_TOKEN} 으로 가입한 판매자 계정을 정지하시겠습니까?`),
    ).toBeVisible();
    await expect(
      page.getByText('주문·정산 기록이 없는 판매자만 되돌릴 수 있습니다.'),
    ).toBeVisible();
    await page.getByRole('button', { name: '되돌리기', exact: true }).click();

    await expect.poll(() => state.rollbackRequests).toContainEqual(USED_TOKEN);
    await expect(page.locator('table')).toContainText('되돌림');
    await expect(
      page.getByRole('button', { name: `${USED_TOKEN} 가입 판매자 되돌리기` }),
    ).toHaveCount(0);
  });

  test('스토어가 연결된 판매자 rollback reason은 사용자 알림으로 드러낸다', async ({ page }) => {
    const state = await openInvite(page);
    state.failNextRollbackReason = 'store_has_records';

    await page.getByRole('button', { name: `${USED_TOKEN} 가입 판매자 되돌리기` }).click();
    await page.getByRole('button', { name: '되돌리기', exact: true }).click();

    await expect.poll(() => state.rollbackRequests).toContainEqual(USED_TOKEN);
    await expect(
      page.getByText('주문·정산 기록이 있는 판매자는 초대 탭에서 되돌릴 수 없습니다.'),
    ).toBeVisible();
  });

  test('데스크톱 테이블은 행별 복사와 발급일·사용일을 함께 표시한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openInvite(page);

    await expect(page.getByRole('columnheader', { name: '발급일' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '사용일' })).toBeVisible();
    await expect(page.getByRole('button', { name: / 복사$/ })).toHaveCount(3);
    await expect(page.getByRole('cell', { name: '05-29 10:00', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '05-29 11:00', exact: true })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: VALID_TOKEN })).toContainText('-');

    await page.getByRole('button', { name: `${VALID_TOKEN} 복사` }).click();
    await expect.poll(() => copiedTokens(page)).toContainEqual(VALID_TOKEN);
    await page.getByRole('button', { name: `${VALID_TOKEN} 복사` }).hover();
    await expect(page.getByRole('tooltip')).toContainText('복사됨');
  });

  test('발급 직후 복사와 행별 복사 상태는 토큰별로 분리된다', async ({ page }) => {
    const state = await openInvite(page);

    await page.getByRole('button', { name: '새 토큰 생성' }).click();
    await expect.poll(() => state.generateRequests).toEqual([7]);
    await expect(page.getByText('생성된 초대 토큰')).toBeVisible();

    await page.getByRole('button', { name: '복사', exact: true }).click();
    await expect(page.getByRole('button', { name: '복사됨!' })).toBeVisible();
    await expect.poll(() => copiedTokens(page)).toContainEqual(GENERATED_TOKEN);

    await page.getByRole('button', { name: `${VALID_TOKEN} 복사` }).click();
    await expect(page.getByRole('button', { name: '복사', exact: true })).toBeVisible();
    await expect.poll(() => copiedTokens(page)).toContainEqual(VALID_TOKEN);
  });

  test('발급 만료기간을 선택해 요청 본문과 만료 안내에 반영한다', async ({ page }) => {
    const state = await openInvite(page);

    await page.getByLabel('초대 만료기간').click();
    await page.getByRole('option', { name: '14일' }).click();
    await page.getByRole('button', { name: '새 토큰 생성' }).click();

    await expect.poll(() => state.generateRequests).toEqual([14]);
    await expect(page.getByText('생성된 초대 토큰')).toBeVisible();
    await expect(page.getByText(/만료: .*6월 12일/)).toBeVisible();
  });

  test('clipboard 권한 실패 시 대체 복사를 사용하고 대체 경로 실패도 알린다', async ({ page }) => {
    await openInvite(page);
    await page.evaluate(() => {
      (window as typeof window & { __clipboardShouldFail?: boolean }).__clipboardShouldFail = true;
    });

    await page.getByRole('button', { name: `${USED_TOKEN} 복사` }).click();
    await expect.poll(() => copiedTokens(page)).toContainEqual(USED_TOKEN);

    await page.evaluate(() => {
      (
        window as typeof window & {
          __execCommandShouldFail?: boolean;
        }
      ).__execCommandShouldFail = true;
    });
    await page.getByRole('button', { name: `${EXPIRED_TOKEN} 복사` }).click();
    await expect(
      page.getByText('토큰 복사에 실패했습니다. 브라우저 권한을 확인해 주세요.'),
    ).toBeVisible();
  });

  test('모바일 카드는 토큰 액션과 일시를 폭 안에 표시한다', async ({ page }) => {
    await setMobileViewport(page);
    await openInvite(page);

    await expect(page.locator('table')).not.toBeVisible();
    await expect(page.getByLabel('초대 토큰 검색')).toBeVisible();
    await expect(page.getByRole('button', { name: / 복사$/ })).toHaveCount(3);
    await expect(page.getByRole('button', { name: `${VALID_TOKEN} 복사` })).toBeVisible();
    await expect(page.getByRole('button', { name: `${VALID_TOKEN} 취소` })).toBeVisible();
    await expect(
      page.locator('.mantine-Badge-root').filter({ hasText: '유효' }).first(),
    ).toBeVisible();
    await expect(
      page.locator('.mantine-Badge-root').filter({ hasText: '사용됨' }).first(),
    ).toBeVisible();
    await expect(
      page.locator('.mantine-Badge-root').filter({ hasText: '만료' }).first(),
    ).toBeVisible();
    await expect(page.getByText(/발급 05-29/).first()).toBeVisible();
    await expect(page.getByText(/사용 -/).first()).toBeVisible();
    await expect(page.getByText(/만료 2099\. 5\. 29\./).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('sm 경계에서 카드와 테이블 표시를 전환한다', async ({ page }) => {
    await openInvite(page);
    await expectAdminTableSwitchAtSm(page);
  });

  test('이미 취소된 reason 응답은 사용자 알림으로 드러낸다', async ({ page }) => {
    const state = await openInvite(page);
    state.failNextRevokeReason = 'already_revoked';

    await page.getByRole('button', { name: `${VALID_TOKEN} 취소` }).click();
    await page.getByRole('button', { name: '취소', exact: true }).last().click();

    await expect.poll(() => state.revokeRequests).toContainEqual(VALID_TOKEN);
    await expect(page.getByText('이미 취소된 토큰입니다.')).toBeVisible();
  });

  for (const scenario of [
    ['already_used', '이미 사용된 토큰은 취소할 수 없습니다.'],
    ['expired', '만료된 토큰은 취소할 수 없습니다.'],
  ] as const) {
    test(`${scenario[0]} reason 응답은 사용자 알림으로 드러낸다`, async ({ page }) => {
      const state = await openInvite(page);
      state.failNextRevokeReason = scenario[0];

      await page.getByRole('button', { name: `${VALID_TOKEN} 취소` }).click();
      await page.getByRole('button', { name: '취소', exact: true }).last().click();

      await expect.poll(() => state.revokeRequests).toContainEqual(VALID_TOKEN);
      await expect(page.getByText(scenario[1])).toBeVisible();
    });
  }

  test('4자 prefix 검색은 취소 UI와 함께 동작한다', async ({ page }) => {
    const state = await openInvite(page);
    const initialRequestCount = state.queryRequests.length;

    await page.getByLabel('초대 토큰 검색').fill('INV');
    await page.waitForTimeout(400);
    expect(state.queryRequests).toHaveLength(initialRequestCount);

    await page.getByLabel('초대 토큰 검색').fill('INVITEVALID');
    await expect.poll(() => state.queryRequests.at(-1)).toBe('INVITEVALID');
    await expect(page.getByRole('button', { name: `${VALID_TOKEN} 복사` })).toBeVisible();
    await expect(page.getByRole('button', { name: `${VALID_TOKEN} 취소` })).toBeVisible();
    await expect(page.getByRole('button', { name: `${USED_TOKEN} 복사` })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.getByLabel('초대 토큰 검색').fill('NOPE');
    await expect.poll(() => state.queryRequests.at(-1)).toBe('NOPE');
    await expect(page.getByText('일치하는 토큰이 없습니다.')).toBeVisible();

    await page.getByLabel('초대 토큰 검색').fill('');
    await expect.poll(() => state.queryRequests.at(-1)).toBe(null);
    await expect(page.getByRole('button', { name: `${VALID_TOKEN} 복사` })).toBeVisible();
    await expect(page.getByRole('button', { name: `${USED_TOKEN} 복사` })).toBeVisible();
  });

  test('다음 페이지가 있으면 더 보기로 초대 내역을 이어 붙인다', async ({ page }) => {
    const state = await openInvite(page);
    state.invites.push(
      {
        token: 'INVITEPAGE000001',
        createdBy: 'admin-1',
        usedAt: null,
        usedBy: null,
        revokedAt: null,
        revokedBy: null,
        sellerRollbackAt: null,
        sellerRollbackBy: null,
        expiresAt: '2099-05-29T03:00:00.000Z',
        createdAt: '2026-04-23T03:00:00.000Z',
      },
      {
        token: 'INVITEPAGE000002',
        createdBy: 'admin-1',
        usedAt: null,
        usedBy: null,
        revokedAt: null,
        revokedBy: null,
        sellerRollbackAt: null,
        sellerRollbackBy: null,
        expiresAt: '2099-05-29T03:00:00.000Z',
        createdAt: '2026-04-22T03:00:00.000Z',
      },
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '더 보기' })).toBeVisible();
    await page.getByRole('button', { name: '더 보기' }).click();

    await expect.poll(() => state.cursorRequests.at(-1)).toBe('2026-04-24T03:00:00.000Z');
    await expect(page.getByRole('button', { name: 'INVITEPAGE000001 복사' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'INVITEPAGE000002 복사' })).toBeVisible();
  });
});
