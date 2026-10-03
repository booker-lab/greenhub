/**
 * 기사 앱 로그인 화면 안내 문구 판정.
 *
 * - `error`: Auth.js가 실패 시 붙이는 값(AccessDenied·CredentialsSignin·Configuration 등)과
 *   기사 앱 proxy가 붙이는 `AdminAccount`.
 *   카카오 로그인에서 API가 승인 전 기사·다른 역할을 403으로 거절하면 signIn 콜백이 false를
 *   반환하고, Auth.js는 `AccessDenied`를 붙여 오류 페이지(`pages.error = '/login'`)로 보낸다.
 * - `pending`: signIn 콜백이 승인 전 기사에게 돌려주는 기존 안내 값.
 *
 * 어떤 경우에도 오류 상세(code·서버 메시지)는 화면에 그대로 노출하지 않는다.
 */

// proxy가 관리자 세션을 기사 화면에서 로그인 안내로 돌려보낼 때 붙이는 값.
export const DRIVER_ADMIN_ACCOUNT_ERROR = 'AdminAccount';

export type DriverLoginNoticeKind = 'pending' | 'access-denied' | 'admin-account' | 'failed';

export type DriverLoginNotice = {
  kind: DriverLoginNoticeKind;
  title: string;
  body: string;
  // 현재 세션을 정리하고 다른 계정으로 로그인할 수 있게 로그아웃 버튼을 함께 보인다.
  offerSignOut: boolean;
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
      body: '배송 주문은 승인된 기사 계정으로만 볼 수 있습니다. 기사 계정으로 다시 로그인해 주세요.',
      offerSignOut: true,
    };
  }
  if (error === 'AccessDenied') {
    return {
      kind: 'access-denied',
      title: '로그인할 수 없는 계정입니다',
      body: '관리자 승인 대기 중이거나 기사 계정이 아닙니다. 승인이 끝났다면 다시 로그인해 주세요.',
      offerSignOut: false,
    };
  }
  if (firstValue(params.pending) === 'true') {
    return {
      kind: 'pending',
      title: '승인 대기 중입니다',
      body: '관리자 승인 후 이용할 수 있습니다. 승인이 완료되면 다시 로그인해 주세요.',
      offerSignOut: false,
    };
  }
  if (error) {
    return {
      kind: 'failed',
      title: '로그인하지 못했습니다',
      body: '잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 문의해 주세요.',
      offerSignOut: false,
    };
  }
  return null;
}
