import type { Page, Route } from '@playwright/test';

export const VALID_TOKEN = 'INVITEVALID00001';
export const USED_TOKEN = 'INVITEUSED000001';
export const EXPIRED_TOKEN = 'INVITEEXPIRED001';
const GENERATED_TOKEN = 'INVITEGENERATED1';

type InviteFixture = {
  token: string;
  createdBy: string;
  usedAt: string | null;
  usedBy: string | null;
  revokedAt?: string | null;
  revokedBy?: string | null;
  sellerRollbackAt?: string | null;
  sellerRollbackBy?: string | null;
  expiresAt: string | null;
  createdAt: string | null;
};

export interface InviteMockState {
  invites: InviteFixture[];
  revokeRequests: string[];
  rollbackRequests: string[];
  generateRequests: number[];
  queryRequests: Array<string | null>;
  cursorRequests: Array<string | null>;
  failNextRevokeReason?: 'already_used' | 'already_revoked' | 'expired';
  failNextRollbackReason?:
    | 'not_used'
    | 'already_rolled_back'
    | 'user_not_found'
    | 'not_seller'
    | 'store_not_found'
    | 'store_has_records';
}

export async function installInviteApiFixture(page: Page): Promise<InviteMockState> {
  const state: InviteMockState = {
    invites: createInviteFixture(),
    revokeRequests: [],
    rollbackRequests: [],
    generateRequests: [],
    queryRequests: [],
    cursorRequests: [],
  };

  await page.route('**/admin/invite**', async (route) => {
    const request = route.request();
    if (request.resourceType() === 'document') {
      await route.continue();
      return;
    }

    const url = new URL(request.url());
    const revokeMatch = url.pathname.match(/\/admin\/invite\/([^/]+)\/revoke$/);
    const rollbackMatch = url.pathname.match(/\/admin\/invite\/([^/]+)\/rollback-seller$/);

    if (request.method() === 'GET' && url.pathname.endsWith('/admin/invite')) {
      await fulfillInviteList(route, state, url);
      return;
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/admin/invite')) {
      await fulfillGenerateInvite(
        route,
        state,
        request.postDataJSON() as { expiresInDays?: number },
      );
      return;
    }
    if (request.method() === 'POST' && revokeMatch) {
      await fulfillRevokeInvite(route, state, revokeMatch[1]);
      return;
    }
    if (request.method() === 'POST' && rollbackMatch) {
      await fulfillRollbackInvite(route, state, rollbackMatch[1]);
      return;
    }

    await route.continue();
  });

  return state;
}

function createInviteFixture(): InviteFixture[] {
  const base = {
    createdBy: 'admin-1',
    revokedAt: null,
    revokedBy: null,
    sellerRollbackAt: null,
    sellerRollbackBy: null,
  };
  return [
    {
      ...base,
      token: VALID_TOKEN,
      usedAt: null,
      usedBy: null,
      expiresAt: '2099-05-29T03:00:00.000Z',
      createdAt: '2026-05-29T01:00:00.000Z',
    },
    {
      ...base,
      token: USED_TOKEN,
      usedAt: '2026-05-29T02:00:00.000Z',
      usedBy: 'seller-1',
      expiresAt: '2099-05-29T03:00:00.000Z',
      createdAt: '2026-05-29T00:30:00.000Z',
    },
    {
      ...base,
      token: EXPIRED_TOKEN,
      usedAt: null,
      usedBy: null,
      expiresAt: '2026-05-01T03:00:00.000Z',
      createdAt: '2026-04-24T03:00:00.000Z',
    },
  ];
}

async function fulfillInviteList(route: Route, state: InviteMockState, url: URL) {
  const q = url.searchParams.get('q') ?? '';
  const cursor = url.searchParams.get('cursor');
  state.queryRequests.push(q || null);
  state.cursorRequests.push(cursor);
  const filtered =
    q.length >= 4 ? state.invites.filter((invite) => invite.token.startsWith(q)) : state.invites;
  const cursorIndex = cursor
    ? filtered.findIndex((invite) => invite.token === cursor || invite.createdAt === cursor)
    : -1;
  const pageStart = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const pageItems = filtered.slice(pageStart, pageStart + 3);
  const nextItem = filtered[pageStart + 2];
  const nextCursor =
    filtered.length > pageStart + 3 ? (q.length >= 4 ? nextItem.token : nextItem.createdAt) : null;
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ invites: pageItems, nextCursor }),
  });
}

async function fulfillGenerateInvite(
  route: Route,
  state: InviteMockState,
  body: { expiresInDays?: number } | null,
) {
  const expiresInDays = body?.expiresInDays ?? 7;
  const expiresAt = expiresInDays === 14 ? '2099-06-12T03:00:00.000Z' : '2099-06-05T03:00:00.000Z';
  state.generateRequests.push(expiresInDays);
  state.invites = [
    {
      token: GENERATED_TOKEN,
      createdBy: 'admin-1',
      usedAt: null,
      usedBy: null,
      revokedAt: null,
      revokedBy: null,
      sellerRollbackAt: null,
      sellerRollbackBy: null,
      expiresAt,
      createdAt: '2026-05-29T03:00:00.000Z',
    },
    ...state.invites,
  ];
  await route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({ token: GENERATED_TOKEN, expiresAt }),
  });
}

async function fulfillRevokeInvite(route: Route, state: InviteMockState, token: string) {
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
}

async function fulfillRollbackInvite(route: Route, state: InviteMockState, token: string) {
  state.rollbackRequests.push(token);
  if (state.failNextRollbackReason) {
    const reason = state.failNextRollbackReason;
    state.failNextRollbackReason = undefined;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ reason, message: '가입 판매자를 되돌릴 수 없습니다.' }),
    });
    return;
  }
  state.invites = state.invites.map((invite) =>
    invite.token === token
      ? { ...invite, sellerRollbackAt: '2026-05-29T03:00:00.000Z', sellerRollbackBy: 'admin-1' }
      : invite,
  );
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, userId: 'seller-1' }),
  });
}
