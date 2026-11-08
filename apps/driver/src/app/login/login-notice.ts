/**
 * 기사 앱 로그인 화면 안내 문구 판정.
 *
 * - `error`: Auth.js가 실패 시 붙이는 값(AccessDenied·CredentialsSignin·Configuration 등)과
 *   기사 앱 카카오 signIn 콜백·proxy가 붙이는 값.
 *   - `AdminAccount`: 관리자 계정 거절. 기사 앱은 기사(driver) 역할만 받으므로(2026-10-04 결정)
 *     관리자 계정에는 세션이 생기지 않는다.
 *   - `ApprovalPending`: API가 승인 전 기사를 `DRIVER_APPROVAL_PENDING` code와 함께 403으로 거절한 경우.
 *     처음 카카오로 들어온 기사는 이때 가입 신청(승인 전 기사 계정)이 만들어진다.
 *   - `AccessDenied`: signIn 콜백이 false를 돌려준 경우. 기사 앱은 API가 code 없이 403으로 거절한
 *     다른 역할(손님·판매자 등) 계정에만 false를 돌려준다.
 *   - 그 밖의 값(일시 실패·정지 계정 등)은 일반 실패 안내.
 * - `reason=expired`: 세션이 끝나 로그인 화면으로 보낸 경우(proxy·화면의 세션 재확인).
 *   `hasReturnPath`가 참이면 다시 로그인했을 때 보던 화면으로 돌아간다고 알린다.
 *
 * 어떤 경우에도 오류 상세(code·서버 메시지)는 화면에 그대로 노출하지 않는다.
 * 운영팀 연락처가 필요한 안내는 `showOpsContact`로 표시하고, 번호는 화면이
 * `DRIVER_OPS_CONTACT`(`@/lib/ops-contact`)에서 읽는다.
 */

// 관리자 계정을 기사 앱 로그인 화면 안내로 돌려보낼 때 붙이는 값.
export const DRIVER_ADMIN_ACCOUNT_ERROR = 'AdminAccount';
// 승인 전 기사를 기사 앱 로그인 화면 안내로 돌려보낼 때 붙이는 값.
export const DRIVER_APPROVAL_PENDING_ERROR = 'ApprovalPending';
// 카카오 로그인이 일시 실패 등으로 끝났을 때 붙이는 값(일반 실패 안내).
export const DRIVER_LOGIN_FAILED_ERROR = 'LoginFailed';

export type DriverLoginNoticeKind =
  | 'approval-pending'
  | 'access-denied'
  | 'admin-account'
  | 'session-ended'
  | 'failed';

export type DriverLoginNotice = {
  kind: DriverLoginNoticeKind;
  title: string;
  body: string;
  // 운영팀 연락처(전화 링크·운영 시간)를 함께 보일지.
  showOpsContact: boolean;
};

type SearchParamValue = string | string[] | undefined;

function firstValue(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function resolveDriverLoginNotice(params: {
  error?: SearchParamValue;
  reason?: SearchParamValue;
  hasReturnPath?: boolean;
}): DriverLoginNotice | null {
  const error = firstValue(params.error)?.trim();
  if (error === DRIVER_ADMIN_ACCOUNT_ERROR) {
    return {
      kind: 'admin-account',
      title: '관리자 계정은 기사 앱을 쓸 수 없습니다',
      body: '기사 계정으로 로그인해 주세요.',
      showOpsContact: false,
    };
  }
  if (error === DRIVER_APPROVAL_PENDING_ERROR) {
    return {
      kind: 'approval-pending',
      title: '가입 신청이 접수됐어요',
      body: '관리자가 승인하면 다시 로그인해 주세요.',
      showOpsContact: true,
    };
  }
  if (error === 'AccessDenied') {
    return {
      kind: 'access-denied',
      title: '기사용 계정이 아니에요',
      body: '기사로 등록한 카카오 계정으로 로그인해 주세요.',
      showOpsContact: false,
    };
  }
  if (error) {
    return {
      kind: 'failed',
      title: '로그인하지 못했어요',
      body: '잠시 후 다시 시도해 주세요. 계속 안 되면 운영팀에 문의해 주세요.',
      showOpsContact: true,
    };
  }
  if (firstValue(params.reason) === 'expired') {
    return {
      kind: 'session-ended',
      title: '로그인이 끝났어요',
      body: params.hasReturnPath
        ? '다시 로그인하면 보던 화면으로 돌아가요.'
        : '다시 로그인해 주세요.',
      showOpsContact: false,
    };
  }
  return null;
}
