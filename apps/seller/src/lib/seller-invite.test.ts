import { describe, expect, it } from 'vitest';
import {
  describeSignInError,
  inviteSignInError,
  isInviteTokenFormat,
  signInErrorPath,
} from './seller-invite';

describe('초대 토큰 형식', () => {
  it('API와 같은 영숫자 1~64자만 받는다', () => {
    expect(isInviteTokenFormat('ABCDEF0123456789')).toBe(true);
    expect(isInviteTokenFormat('A'.repeat(64))).toBe(true);
    for (const value of ['', 'A'.repeat(65), 'A/B', '../X', 'BAD-TOKEN', 'A B', undefined, 1]) {
      expect(isInviteTokenFormat(value)).toBe(false);
    }
  });
});

describe('초대 가입 실패 사유', () => {
  it('410은 만료, 409는 reason별로 나누고 reason 없는 409는 사용됨이다', () => {
    expect(inviteSignInError(410, {})).toBe('InviteExpired');
    expect(inviteSignInError(409, { reason: 'already_revoked' })).toBe('InviteRevoked');
    expect(inviteSignInError(409, { reason: 'recipient_mismatch' })).toBe('InviteEmailMismatch');
    expect(inviteSignInError(409, { reason: 'kakao_account_in_use' })).toBe('InviteAccountInUse');
    expect(inviteSignInError(409, { message: '이미 사용된 초대 토큰입니다.' })).toBe('InviteUsed');
    expect(inviteSignInError(409, null)).toBe('InviteUsed');
  });

  it('400·403·404는 잘못된 초대이고, 초대와 무관한 실패는 null이다', () => {
    for (const status of [400, 403, 404])
      expect(inviteSignInError(status, {})).toBe('InviteInvalid');
    for (const status of [401, 429, 500, 503]) expect(inviteSignInError(status, {})).toBeNull();
  });

  it('오류 화면 경로에 사유를 싣는다', () => {
    expect(signInErrorPath('InviteExpired')).toBe('/login/error?error=InviteExpired');
  });
});

describe('로그인 오류 안내', () => {
  it('초대 사유와 AccessDenied는 각자의 한국어 안내를, 모르는 값은 일반 안내를 보여 준다', () => {
    expect(describeSignInError('InviteAccountInUse').message).toContain('다른 카카오 계정');
    expect(describeSignInError('InviteExpired').message).toContain('72시간');
    expect(describeSignInError('AccessDenied').message).toContain('초대 링크');
    expect(describeSignInError('Configuration').title).toBe('로그인하지 못했어요');
    expect(describeSignInError('toString').title).toBe('로그인하지 못했어요');
    expect(describeSignInError(undefined).title).toBe('로그인하지 못했어요');
  });
});
