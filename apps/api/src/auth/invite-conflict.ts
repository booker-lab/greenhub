import { ConflictException } from '@nestjs/common';

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

export function inviteConflict(reason: InviteConflictReason, message: string): ConflictException {
  return new ConflictException({ statusCode: 409, message, error: 'Conflict', reason });
}
