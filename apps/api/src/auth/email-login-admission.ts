// 운영 런타임의 이메일 로그인 허용 판정(2026-10-27 결정).
//
// 운영 화면은 카카오 로그인만 쓰지만, 결제사(카카오페이) 연동 심사는 심사 담당자가 사이트에
// ID·비밀번호로 로그인해 결제창까지 가 보는 구매 테스트를 요구한다. 그래서 운영 런타임은
// 사용자 문서에 심사 허용 만료 시각(`emailLoginAllowedUntil`)이 남아 있는 계정에 한해
// 이메일 로그인을 받는다. 그 밖의 계정(표식 없음·만료·계정 없음)은 비밀번호가 맞아도
// 같은 403으로 끝낸다. 표식은 운영 유지보수 스크립트(`scripts/ops/create-email-review-account.mjs`)
// 만 쓰고, 공개 API나 앱 화면에는 이 값을 바꾸는 경로가 없다.

export const EMAIL_LOGIN_ALLOWED_UNTIL_FIELD = 'emailLoginAllowedUntil';
export const PRODUCTION_EMAIL_LOGIN_BLOCKED_MESSAGE = '이메일 로그인은 지원하지 않습니다.';

type MillisLike = { toMillis: () => number };

function readMillis(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<MillisLike>).toMillis === 'function'
  ) {
    const millis = (value as MillisLike).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

/**
 * 운영 런타임에서 이 사용자 문서의 이메일 로그인을 허용할지 판정한다.
 * 문서가 없거나, 만료 시각 필드가 없거나(또는 Timestamp·Date가 아니거나), 이미 지났으면 거부한다.
 */
export function isProductionEmailLoginAdmitted(
  userData: Record<string, unknown> | undefined,
  nowMillis: number,
): boolean {
  if (!userData || !Number.isFinite(nowMillis)) return false;
  const allowedUntil = readMillis(userData[EMAIL_LOGIN_ALLOWED_UNTIL_FIELD]);
  return allowedUntil !== null && allowedUntil > nowMillis;
}
