// 판매자 초대 링크(/invite/[token]) → 카카오 로그인 → 판매자 가입 흐름의 공용 규칙.
// 초대 화면(쿠키 저장), auth.ts signIn 콜백(쿠키 읽기·kakao-login 전달), 로그인 오류 화면이 같이 쓴다.

/** 초대 토큰을 카카오 로그인 왕복 동안 담아 두는 쿠키. httpOnly라 화면 스크립트는 읽지 못한다. */
export const SELLER_INVITE_COOKIE = 'greenhub-seller-invite';

/** 카카오 로그인 왕복에 충분한 짧은 수명(10분). 지나면 초대 링크를 다시 열어야 한다. */
export const SELLER_INVITE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

// API(invite-conflict.ts)와 같은 규칙: 발급 토큰은 영숫자 1~64자다.
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9]{1,64}$/;

export function isInviteTokenFormat(value: unknown): value is string {
  return typeof value === 'string' && INVITE_TOKEN_PATTERN.test(value);
}

/** 초대 가입 실패 사유. 로그인 오류 화면의 `?error=` 값으로 쓴다. */
export type InviteSignInError =
  | 'InviteInvalid'
  | 'InviteExpired'
  | 'InviteRevoked'
  | 'InviteUsed'
  | 'InviteEmailMismatch'
  | 'InviteAccountInUse';

/**
 * 초대 토큰을 실은 kakao-login 실패 응답을 사유로 옮긴다. 초대와 무관한 실패(401·5xx 등)는 null.
 * 409는 본문 reason으로 나누고, reason 없는 409는 이미 쓰인 초대다(API 가입 트랜잭션 재판정).
 */
export function inviteSignInError(status: number, body: unknown): InviteSignInError | null {
  if (status === 410) return 'InviteExpired';
  if (status === 409) {
    const reason =
      body !== null && typeof body === 'object' ? (body as { reason?: unknown }).reason : undefined;
    if (reason === 'already_revoked') return 'InviteRevoked';
    if (reason === 'recipient_mismatch') return 'InviteEmailMismatch';
    if (reason === 'kakao_account_in_use') return 'InviteAccountInUse';
    return 'InviteUsed';
  }
  if (status === 400 || status === 403 || status === 404) return 'InviteInvalid';
  return null;
}

export const SIGN_IN_ERROR_PATH = '/login/error';

export function signInErrorPath(error: InviteSignInError): string {
  return `${SIGN_IN_ERROR_PATH}?error=${error}`;
}

export interface SignInErrorNotice {
  title: string;
  message: string;
}

const ASK_NEW_INVITE = '관리자에게 새 초대 링크를 요청해 주세요.';

const SIGN_IN_ERROR_NOTICES: Record<InviteSignInError | 'AccessDenied', SignInErrorNotice> = {
  InviteInvalid: {
    title: '초대 링크를 확인할 수 없어요',
    message: `링크 주소가 잘렸거나 잘못된 초대예요. ${ASK_NEW_INVITE}`,
  },
  InviteExpired: {
    title: '초대 링크가 만료됐어요',
    message: `초대 링크는 받은 뒤 72시간 동안만 쓸 수 있어요. ${ASK_NEW_INVITE}`,
  },
  InviteRevoked: {
    title: '취소된 초대 링크예요',
    message: `관리자가 이 초대를 취소했어요. ${ASK_NEW_INVITE}`,
  },
  InviteUsed: {
    title: '이미 사용된 초대 링크예요',
    message: `초대 링크는 한 번만 쓸 수 있어요. 이 링크로 이미 가입했다면 로그인 화면에서 카카오로 로그인해 주세요.`,
  },
  InviteEmailMismatch: {
    title: '초대받은 이메일과 카카오 이메일이 달라요',
    message: `초대받은 이메일을 쓰는 카카오 계정으로 다시 시도하거나, ${ASK_NEW_INVITE}`,
  },
  InviteAccountInUse: {
    title: '이미 가입된 카카오 계정이에요',
    message:
      '이 카카오 계정은 손님 등 다른 용도로 이미 가입돼 있어요. 다른 카카오 계정으로 가입해 주세요.',
  },
  AccessDenied: {
    title: '판매자 계정으로 로그인할 수 없어요',
    message:
      '판매자 계정이 아니거나 아직 가입하지 않은 카카오 계정이에요. 처음 가입하는 분은 관리자가 보낸 초대 링크로 들어와 주세요.',
  },
};

const DEFAULT_SIGN_IN_ERROR_NOTICE: SignInErrorNotice = {
  title: '로그인하지 못했어요',
  message: '잠시 뒤 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요.',
};

/** 로그인 오류 화면 안내. 모르는 값(Auth.js 내부 오류 코드 등)은 일반 안내로 보여 준다. */
export function describeSignInError(error: string | undefined): SignInErrorNotice {
  if (error && Object.hasOwn(SIGN_IN_ERROR_NOTICES, error)) {
    return SIGN_IN_ERROR_NOTICES[error as keyof typeof SIGN_IN_ERROR_NOTICES];
  }
  return DEFAULT_SIGN_IN_ERROR_NOTICE;
}
