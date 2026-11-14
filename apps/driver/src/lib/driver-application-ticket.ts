/**
 * 기사 가입 신청 티켓 쿠키와 로그인 뒤 이동 판정 (Next·DOM 의존 없음, vitest로 검증).
 *
 * 승인 전 기사의 카카오 로그인은 API가 403 `DRIVER_APPROVAL_PENDING`으로 거절하면서 30분짜리
 * 가입 신청 티켓(`applicationTicket`)과 신청 상태(`applicationStatus`: none·submitted)를 함께 준다
 * (`apps/api/src/auth/auth.service.ts`, API의 가입 신청 기능이 켜졌을 때만). 기사 앱 카카오 signIn 콜백은 세션을 만들지 않고 티켓만
 * httpOnly 쿠키(경로 `/apply`, 30분)에 담은 뒤
 * - 신청 전(none) → `/apply`(신청 화면)
 * - 신청 뒤(submitted) → `/login?error=ApprovalPending&application=submitted`(접수 안내 + "신청 내용 수정" 링크)
 * 로 보낸다. 티켓은 브라우저 스크립트가 읽을 수 없고 `/apply` 화면·서버 액션만 서버에서 읽는다.
 */

export const DRIVER_APPLY_PATH = '/apply';
export const DRIVER_APPLICATION_TICKET_COOKIE = 'greenhub-driver-apply';
/** API 티켓 수명(30분)과 같다. 쿠키가 남아도 API가 만료된 티켓을 401로 거절한다. */
export const DRIVER_APPLICATION_TICKET_MAX_AGE_SECONDS = 30 * 60;

// JWT 세 조각(base64url)만 받는다. 쿠키 크기 한도 안에서 넉넉한 길이 상한을 둔다.
const TICKET_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_TICKET_LENGTH = 2048;

export type DriverApplicationLoginStatus = 'none' | 'submitted';

export interface DriverApplicationRejection {
  ticket: string;
  status: DriverApplicationLoginStatus;
}

export function isDriverApplicationTicket(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_TICKET_LENGTH && TICKET_PATTERN.test(value)
  );
}

/**
 * 카카오 로그인 거절 본문에서 신청 티켓과 상태를 읽는다. 둘 중 하나라도 형식이 다르면 null
 * (그때는 티켓 없이 지금처럼 승인 대기 안내로 보낸다).
 */
export function readDriverApplicationRejection(body: unknown): DriverApplicationRejection | null {
  if (typeof body !== 'object' || body === null) return null;
  const { applicationTicket, applicationStatus } = body as Record<string, unknown>;
  if (!isDriverApplicationTicket(applicationTicket)) return null;
  if (applicationStatus !== 'none' && applicationStatus !== 'submitted') return null;
  return { ticket: applicationTicket, status: applicationStatus };
}

/** 티켓을 담은 뒤 보낼 곳. 신청 전이면 신청 화면, 낸 뒤면 접수 안내(수정 링크 포함). */
export function driverApplicationRedirectPath(
  status: DriverApplicationLoginStatus,
  approvalPendingLoginUrl: string,
): string {
  return status === 'none' ? DRIVER_APPLY_PATH : approvalPendingLoginUrl;
}

/** Host 헤더(포트 포함 가능)가 이 컴퓨터(localhost·127.0.0.1·::1)인지. */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const value = host.trim().toLowerCase();
  const hostname = value.startsWith('[')
    ? value.slice(1, value.indexOf(']'))
    : value.replace(/:\d+$/, '');
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  );
}

export interface DriverApplicationCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: typeof DRIVER_APPLY_PATH;
  maxAge: number;
}

/**
 * 티켓 쿠키 속성. httpOnly·SameSite=Lax·경로 `/apply`·30분. Secure는 https 배포에서 켜고,
 * http로 여는 로컬(localhost)에서만 끈다(브라우저가 http에서 Secure 쿠키를 버리는 경우가 있어서).
 */
export function driverApplicationCookieOptions(
  host: string | null | undefined,
): DriverApplicationCookieOptions {
  return {
    httpOnly: true,
    secure: !isLoopbackHost(host),
    sameSite: 'lax',
    path: DRIVER_APPLY_PATH,
    maxAge: DRIVER_APPLICATION_TICKET_MAX_AGE_SECONDS,
  };
}
