import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 초대 취소(revoke)의 실패 처리와 2xx 뒤 재조회를 fetch 모의로 확인한다.
// DOM 없이 훅을 한 번 호출하려고 React 훅을 최소 구현으로 바꾼다(useEffect의 자동 조회는 돌리지 않는다).
vi.mock('react', () => ({
  useState: <T>(initial: T | (() => T)) => [
    typeof initial === 'function' ? (initial as () => T)() : initial,
    () => undefined,
  ],
  useCallback: <T>(fn: T) => fn,
  useEffect: () => undefined,
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { accessToken: 'tok' } }, status: 'authenticated' }),
}));
// vitest에는 '@/' 별칭 설정이 없어 lib/api는 실제 구현을 그대로 다시 내보내고, API 주소만 대신한다.
vi.mock('@/lib/api-base-url', () => ({ getApiBaseUrl: () => 'http://api.test' }));
vi.mock('@/lib/api', () => import('../lib/api'));

import { SERVER_SAVE_FAILED_MESSAGE } from '../lib/api';
import { useAdminInvite } from './useAdmin.invite';

const REVOKE_URL = 'http://api.test/admin/invite/inv%2F1/revoke';
const LIST_URL = 'http://api.test/admin/invite';

type Reply = { status: number; body?: unknown };

function jsonResponse({ status, body }: Reply): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** URL별로 준비한 응답을 차례로 돌려주는 fetch 모의. 호출 순서도 기록한다. */
function mockFetch(replies: Record<string, Array<Reply | Error>>) {
  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    const next = replies[url]?.shift();
    if (!next) throw new Error(`예상하지 못한 요청: ${url}`);
    if (next instanceof Error) throw next;
    return jsonResponse(next);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function calledUrls(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls.map(([input, init]) => `${init?.method ?? 'GET'} ${String(input)}`);
}

describe('초대 취소 결과', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('409 거부는 서버 안내와 reason을 그대로 보존하고 목록을 다시 조회하지 않는다', async () => {
    const fetchMock = mockFetch({
      [REVOKE_URL]: [
        { status: 409, body: { message: '이미 사용된 초대입니다.', reason: 'already_used' } },
      ],
    });
    const outcome = await useAdminInvite().revoke('inv/1');
    expect(outcome).toEqual({
      kind: 'rejected',
      status: 409,
      message: '이미 사용된 초대입니다.',
      reason: 'already_used',
    });
    expect(calledUrls(fetchMock)).toEqual([`POST ${REVOKE_URL}`]);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('reason이 없거나 문자열이 아닌 4xx는 서버 한국어 안내를 유지하고 reason은 null', async () => {
    mockFetch({
      [REVOKE_URL]: [
        { status: 404, body: { message: '초대를 찾을 수 없습니다.' } },
        { status: 400, body: { message: '잘못된 요청입니다.', reason: 42 } },
      ],
    });
    const invite = useAdminInvite();
    await expect(invite.revoke('inv/1')).resolves.toEqual({
      kind: 'rejected',
      status: 404,
      message: '초대를 찾을 수 없습니다.',
      reason: null,
    });
    await expect(invite.revoke('inv/1')).resolves.toEqual({
      kind: 'rejected',
      status: 400,
      message: '잘못된 요청입니다.',
      reason: null,
    });
  });

  it('본문 메시지가 없는 4xx는 한국어 저장 실패 안내로 바꾼다', async () => {
    mockFetch({ [REVOKE_URL]: [{ status: 403 }] });
    await expect(useAdminInvite().revoke('inv/1')).resolves.toEqual({
      kind: 'rejected',
      status: 403,
      message: SERVER_SAVE_FAILED_MESSAGE,
      reason: null,
    });
  });

  it('영문 5xx는 원문 대신 한국어 안내를 쓰고, 적용 여부 불확정(unknown)으로 다시 조회를 권한다', async () => {
    const fetchMock = mockFetch({
      [REVOKE_URL]: [{ status: 500, body: { message: 'Internal server error', reason: 'x' } }],
    });
    const outcome = await useAdminInvite().revoke('inv/1');
    expect(outcome.kind).toBe('unknown');
    expect(outcome).not.toHaveProperty('reason');
    expect(outcome.kind === 'unknown' && outcome.message).toContain(SERVER_SAVE_FAILED_MESSAGE);
    expect(outcome.kind === 'unknown' && outcome.message).toContain('먼저 목록을 다시 조회해');
    expect(outcome.kind === 'unknown' && outcome.message).not.toContain('Internal server error');
    expect(calledUrls(fetchMock)).toEqual([`POST ${REVOKE_URL}`]);
  });

  it('본문이 없거나 JSON이 아닌 5xx도 한국어 안내로 바꾼다', async () => {
    mockFetch({ [REVOKE_URL]: [{ status: 502 }] });
    const empty = await useAdminInvite().revoke('inv/1');
    expect(empty.kind === 'unknown' && empty.message).toContain(SERVER_SAVE_FAILED_MESSAGE);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })),
    );
    const html = await useAdminInvite().revoke('inv/1');
    expect(html.kind === 'unknown' && html.message).toContain(SERVER_SAVE_FAILED_MESSAGE);
    expect(html.kind === 'unknown' && html.message).not.toContain('Bad Gateway');
  });

  it('서버가 일부러 담은 한국어 5xx 안내는 살린다', async () => {
    mockFetch({
      [REVOKE_URL]: [{ status: 503, body: { message: '잠시 뒤 다시 시도해 주세요.' } }],
    });
    const outcome = await useAdminInvite().revoke('inv/1');
    expect(outcome.kind).toBe('unknown');
    expect(outcome.kind === 'unknown' && outcome.message).toContain('잠시 뒤 다시 시도해 주세요.');
  });

  it('요청 자체가 실패(네트워크)하면 unknown으로 다시 조회를 권한다', async () => {
    mockFetch({ [REVOKE_URL]: [new TypeError('Failed to fetch')] });
    const outcome = await useAdminInvite().revoke('inv/1');
    expect(outcome.kind).toBe('unknown');
    expect(outcome.kind === 'unknown' && outcome.message).toContain('먼저 목록을 다시 조회해');
  });

  it('2xx면 목록을 다시 조회하고, 조회가 성공하면 확인 완료(reconciled)다', async () => {
    const fetchMock = mockFetch({
      [REVOKE_URL]: [{ status: 200, body: { ok: true } }],
      [LIST_URL]: [{ status: 200, body: { invites: [], hasMore: false, limit: 50 } }],
    });
    await expect(useAdminInvite().revoke('inv/1')).resolves.toEqual({
      kind: 'confirmed',
      reconciled: true,
    });
    expect(calledUrls(fetchMock)).toEqual([`POST ${REVOKE_URL}`, `GET ${LIST_URL}`]);
  });

  it('2xx 뒤 재조회가 실패하면 취소를 실패로 되돌리지 않고 조회 실패만 알린다', async () => {
    const fetchMock = mockFetch({
      [REVOKE_URL]: [{ status: 204 }],
      [LIST_URL]: [{ status: 500, body: { message: 'Internal server error' } }],
    });
    await expect(useAdminInvite().revoke('inv/1')).resolves.toEqual({
      kind: 'confirmed',
      reconciled: false,
      readError: '초대 토큰 조회 중 오류 발생',
    });
    expect(calledUrls(fetchMock)).toEqual([`POST ${REVOKE_URL}`, `GET ${LIST_URL}`]);
  });
});
