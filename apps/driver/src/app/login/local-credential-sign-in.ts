/**
 * 로컬 파일럿 이메일 로그인(Credentials, local runtime 전용) 결과 판정.
 *
 * 운영·Preview 화면에는 이 입력칸이 없다(`page.tsx`의 `showLocalCredentials`). 카카오 로그인과
 * Preview E2E 판정(g2~g10)은 이 파일을 쓰지 않는다.
 *
 * - 로그인 화면의 서버 액션은 성공·실패 모두 이동할 주소(`redirectTo`)만 돌려주고, 폼(클라이언트)이
 *   전체 페이지로 이동한다. 서버 액션 안의 화면 이동은 클라이언트 이동이라 `SessionProvider`가
 *   새 세션 쿠키를 다시 읽지 않기 때문이다.
 * - 승인 전 기사는 `authorizeLocalDriver`(`auth.ts`)가 아래 code를 실은 `CredentialsSignin`을 던지고,
 *   서버 액션이 그 code를 읽어 승인 대기 안내로 보낸다. 그 밖의 실패(틀린 비밀번호·정지 계정·
 *   다른 역할·API 응답 없음 등)는 일반 실패 안내다.
 */
import { DRIVER_APPROVAL_PENDING_ERROR, DRIVER_LOGIN_FAILED_ERROR } from './login-notice';
import {
  DRIVER_DEFAULT_RETURN_PATH,
  DRIVER_LOGIN_PATH,
  safeDriverReturnPath,
} from '@/lib/login-redirect';

// 승인 전 기사의 로컬 이메일 로그인 거절을 Auth.js `CredentialsSignin.code`로 나르는 값.
// 고정 문자열만 싣는다(이메일·서버 메시지 없음).
export const LOCAL_DRIVER_APPROVAL_PENDING_CODE = 'local-driver-approval-pending';

export type LocalCredentialSignInResult = {
  // 같은 출처 앱 경로. 폼이 window.location.replace로 전체 이동한다(로그인 화면 기록을 남기지 않는다).
  redirectTo: string;
};

/**
 * 로컬 이메일 로그인이 실패했을 때 보낼 로그인 화면 주소.
 * 승인 대기 code면 `?error=ApprovalPending`, 그 밖은 `?error=LoginFailed`.
 * 돌아갈 경로가 허용되고 기본값(`/board`)이 아니면 `callbackUrl`로 다시 실어 재시도해도 같은 곳으로 간다.
 */
export function localCredentialFailurePath(params: {
  code: unknown;
  returnPath?: string | null;
}): string {
  const query = new URLSearchParams();
  query.set(
    'error',
    params.code === LOCAL_DRIVER_APPROVAL_PENDING_CODE
      ? DRIVER_APPROVAL_PENDING_ERROR
      : DRIVER_LOGIN_FAILED_ERROR,
  );
  const returnPath = safeDriverReturnPath(params.returnPath);
  if (returnPath && returnPath !== DRIVER_DEFAULT_RETURN_PATH) {
    query.set('callbackUrl', returnPath);
  }
  return `${DRIVER_LOGIN_PATH}?${query}`;
}
