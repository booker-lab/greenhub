import { ConflictException, NotFoundException } from '@nestjs/common';

// 초대 토큰 상태 충돌을 화면이 구분할 수 있게 409 본문에 붙이는 reason 코드.
// 관리자 취소(POST /admin/invite/:token/revoke)와 판매자 가입(POST /auth/register)이 같은 값을 쓴다.
// recipient_mismatch는 받는 사람 이메일을 지정한 초대에 다른 이메일로 가입할 때만 쓴다.
export type InviteConflictReason =
  | 'already_revoked'
  | 'already_used'
  | 'expired'
  | 'recipient_mismatch';

export const INVITE_REVOKED_MESSAGE = '취소된 초대 토큰입니다.';
export const INVITE_RECIPIENT_MISMATCH_MESSAGE = '초대받은 이메일로만 가입할 수 있습니다.';
export const INVITE_NOT_FOUND_MESSAGE = '초대 토큰을 찾을 수 없습니다.';

// 발급 토큰은 영숫자뿐이다. 경로 구분자 등이 섞인 값으로 다른 문서를 가리키지 못하게 막는다.
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9]{1,64}$/;

/**
 * 초대 토큰을 `invites/{token}` 문서 경로에 쓰기 전에 형식을 확인한다.
 * 관리자 취소와 판매자 가입이 같은 규칙을 쓰고, 형식이 틀리면 둘 다 404로 거부한다.
 */
export function assertInviteTokenFormat(token: string): void {
  if (!INVITE_TOKEN_PATTERN.test(token)) {
    throw new NotFoundException(INVITE_NOT_FOUND_MESSAGE);
  }
}

export function inviteConflict(reason: InviteConflictReason, message: string): ConflictException {
  return new ConflictException({ statusCode: 409, message, error: 'Conflict', reason });
}
