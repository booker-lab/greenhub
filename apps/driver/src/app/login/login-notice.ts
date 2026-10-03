/**
 * 기사 앱 로그인 화면 안내 문구 판정.
 *
 * - `error`: Auth.js가 실패 시 붙이는 값(AccessDenied·CredentialsSignin·Configuration 등)과
 *   기사 앱이 관리자 계정을 거절할 때 붙이는 `AdminAccount`(카카오 signIn 콜백·proxy).
 *   기사 앱은 기사(driver) 역할만 받으므로(2026-10-04 결정) 관리자 계정에는 세션이 생기지 않는다.
 *   카카오 로그인에서 API가 승인 전 기사·다른 역할을 403으로 거절하면 signIn 콜백이 false를
 *   반환하고, Auth.js는 `AccessDenied`를 붙여 오류 페이지(`pages.error = '/login'`)로 보낸다.
 * - `pending`: signIn 콜백이 승인 전 기사에게 돌려주는 기존 안내 값.
 *
 * 어떤 경우에도 오류 상세(code·서버 메시지)는 화면에 그대로 노출하지 않는다.
 */

// 관리자 계정을 기사 앱 로그인 화면 안내로 돌려보낼 때 붙이는 값.
export const DRIVER_ADMIN_ACCOUNT_ERROR = 'AdminAccount';

export type DriverLoginNoticeKind = 'pending' | 'access-denied' | 'admin-account' | 'failed';

export type DriverLoginNotice = {
  kind: DriverLoginNoticeKind;
  title: string;
  body: string;
};

type SearchParamValue = string | string[] | undefined;

function firstValue(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function resolveDriverLoginNotice(params: {
  pending?: SearchParamValue;
  error?: SearchParamValue;
}): DriverLoginNotice | null {
  const error = firstValue(params.error)?.trim();
  if (error === DRIVER_ADMIN_ACCOUNT_ERROR) {
    return {
      kind: 'admin-account',
      title: '관리자 계정은 기사 앱을 쓸 수 없습니다',
      body: '기사 계정으로 로그인해 주세요.',
    };
  }
  if (error === 'AccessDenied') {
    return {
      kind: 'access-denied',
      title: '로그인할 수 없는 계정입니다',
      body: '관리자 승인 대기 중이거나 기사 계정이 아닙니다. 승인이 끝났다면 다시 로그인해 주세요.',
    };
  }
  if (firstValue(params.pending) === 'true') {
    return {
      kind: 'pending',
      title: '승인 대기 중입니다',
      body: '관리자 승인 후 이용할 수 있습니다. 승인이 완료되면 다시 로그인해 주세요.',
    };
  }
  if (error) {
    return {
      kind: 'failed',
      title: '로그인하지 못했습니다',
      body: '잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 문의해 주세요.',
    };
  }
  return null;
}
