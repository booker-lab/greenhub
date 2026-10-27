// 로그인 화면의 이메일 폼 노출 조건.
// - E2E 런타임(`E2E_TEST === 'true'`)에서는 늘 보인다(기존 계약).
// - 운영을 포함한 모든 런타임에서 `/login?method=email`로 들어온 요청에는 보인다(2026-10-27 결정).
//   결제사(카카오페이) 연동 심사 담당자처럼 안내받은 주소로 들어온 사람만 폼을 보고,
//   일반 손님 화면은 카카오 로그인만 유지한다.
// 폼 노출은 권한 통제가 아니다. 운영 API는 심사 허용 만료 시각이 남은 계정만 이메일 로그인을 받는다.

export const EMAIL_LOGIN_METHOD_QUERY = 'method';
export const EMAIL_LOGIN_METHOD_VALUE = 'email';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export function shouldShowEmailLoginForm(
  // process.env(NodeJS.ProcessEnv)를 그대로 받는다. 읽는 키는 E2E_TEST뿐이다.
  env: Record<string, string | undefined>,
  searchParams: SearchParamsRecord,
): boolean {
  if (env.E2E_TEST === 'true') return true;
  return searchParams[EMAIL_LOGIN_METHOD_QUERY] === EMAIL_LOGIN_METHOD_VALUE;
}
