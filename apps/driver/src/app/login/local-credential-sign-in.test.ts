import { describe, expect, it, vi } from 'vitest';

// vitest에는 '@/' 별칭 설정이 없어 같은 모듈로 잇는다.
vi.mock('@/lib/login-redirect', () => import('../../lib/login-redirect'));

const { LOCAL_DRIVER_APPROVAL_PENDING_CODE, localCredentialFailurePath } = await import(
  './local-credential-sign-in'
);
const { resolveDriverLoginNotice } = await import('./login-notice');

function noticeKindOf(path: string) {
  const params = new URL(path, 'http://driver.example.test').searchParams;
  return resolveDriverLoginNotice({
    error: params.get('error') ?? undefined,
    hasReturnPath: params.has('callbackUrl'),
  })?.kind;
}

describe('로컬 이메일 로그인 실패 이동 주소', () => {
  it('승인 대기 code면 승인 대기 안내로 보낸다', () => {
    const path = localCredentialFailurePath({ code: LOCAL_DRIVER_APPROVAL_PENDING_CODE });
    expect(path).toBe('/login?error=ApprovalPending');
    expect(noticeKindOf(path)).toBe('approval-pending');
  });

  it('그 밖의 실패(기본 CredentialsSignin code·code 없음·다른 값)는 일반 실패 안내로 보낸다', () => {
    for (const code of ['credentials', undefined, null, '', 'DRIVER_APPROVAL_PENDING', 42]) {
      const path = localCredentialFailurePath({ code });
      expect(path).toBe('/login?error=LoginFailed');
      expect(noticeKindOf(path)).toBe('failed');
    }
  });

  it('허용된 복귀 경로는 callbackUrl로 다시 싣고, 기본값·허용하지 않는 값은 싣지 않는다', () => {
    expect(
      localCredentialFailurePath({
        code: LOCAL_DRIVER_APPROVAL_PENDING_CODE,
        returnPath: '/board/order-1?tab=delivering',
      }),
    ).toBe('/login?error=ApprovalPending&callbackUrl=%2Fboard%2Forder-1%3Ftab%3Ddelivering');
    for (const returnPath of ['/board', null, undefined, '//evil.com', 'https://evil.com', '/login']) {
      expect(localCredentialFailurePath({ code: 'credentials', returnPath })).toBe(
        '/login?error=LoginFailed',
      );
    }
  });
});
