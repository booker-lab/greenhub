import {
  authUpstreamSignal,
  type DriverApplicationInput,
  type DriverApplicationStatus,
  type DriverApplicationView,
} from '@greenhub/shared';
import { getApiBaseUrl } from './api-base-url';

// 서버 전용: 가입 신청 티켓으로 API `GET·PUT /driver-applications/me`를 부른다(`/apply` 화면·서버 액션).
// 거절 code는 `apps/api/src/driver-applications/driver-application-ticket.guard.ts`·`driver-applications.service.ts`와 같다.

export type DriverApplicationFailure =
  // 티켓 만료·위조·계정 없음(401) → 카카오로 다시 로그인
  | 'expired'
  // 이미 승인된 기사(403 DRIVER_ALREADY_APPROVED) → 작업 보드
  | 'approved'
  // 기사가 아닌 계정·정지된 기사(403) → 운영팀 문의
  | 'not-allowed'
  // 수정 횟수 상한(409 DRIVER_APPLICATION_REVISION_LIMIT) → 운영팀 문의
  | 'revision-limit'
  // 입력 검증 거절(400) → 입력 확인
  | 'invalid'
  // 응답 없음·시간 초과·5xx·429 등 → 잠시 후 다시
  | 'failed';

export function classifyDriverApplicationFailure(
  status: number,
  code: unknown,
): DriverApplicationFailure {
  if (status === 401) return 'expired';
  if (status === 403) return code === 'DRIVER_ALREADY_APPROVED' ? 'approved' : 'not-allowed';
  if (status === 409 && code === 'DRIVER_APPLICATION_REVISION_LIMIT') return 'revision-limit';
  if (status === 400) return 'invalid';
  return 'failed';
}

export interface DriverApplicationMine {
  status: DriverApplicationStatus;
  application: DriverApplicationView | null;
  prefill: { realName: string };
}

type Result<T> = { ok: true; data: T } | { ok: false; failure: DriverApplicationFailure };

async function call<T>(ticket: string, init: RequestInit): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/driver-applications/me`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${ticket}` },
      cache: 'no-store',
      signal: authUpstreamSignal(),
    });
  } catch {
    return { ok: false, failure: 'failed' };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code =
      typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
    return { ok: false, failure: classifyDriverApplicationFailure(res.status, code) };
  }
  if (typeof body !== 'object' || body === null) return { ok: false, failure: 'failed' };
  return { ok: true, data: body as T };
}

export function fetchMyDriverApplication(ticket: string): Promise<Result<DriverApplicationMine>> {
  return call<DriverApplicationMine>(ticket, { method: 'GET' });
}

export function saveMyDriverApplication(
  ticket: string,
  input: DriverApplicationInput,
): Promise<Result<{ status: 'submitted'; application: DriverApplicationView }>> {
  return call(ticket, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
