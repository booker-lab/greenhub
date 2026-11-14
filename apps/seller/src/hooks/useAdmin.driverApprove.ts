/**
 * 기사 승인 요청과 가입 신청 회차 충돌 처리 — 순수 함수.
 * vitest에서 `@/` alias 없이 직접 검증할 수 있도록 framework 의존성을 두지 않는다.
 *
 * 관리자는 승인 대기 상자에서 본 가입 신청의 회차(revision, 신청 정보가 없으면 0)를
 * `expectedRevision`으로 보낸다. 그 사이 기사가 신청을 고쳤거나 새로 냈으면 API가
 * 409 `DRIVER_APPLICATION_CHANGED`로 거절하고(`apps/api/src/admin/admin.service.ts` approveDriver),
 * 화면은 "신청 내용이 바뀌었어요" 안내 뒤 목록을 다시 읽는다.
 */
import {
  type AdminCommandOutcome,
  classifyAdminCommandError,
  missingTokenOutcome,
  resolveConfirmedOutcome,
} from './useAdmin.outcome';

export const DRIVER_APPLICATION_CHANGED_CODE = 'DRIVER_APPLICATION_CHANGED';
export const DRIVER_APPLICATION_CHANGED_MESSAGE = '신청 내용이 바뀌었어요. 다시 확인해 주세요.';

/** 승인 요청(PATCH /admin/drivers/:userId/approve). 본 신청 회차를 함께 보낸다. */
export function buildDriverApproveRequest(
  userId: string,
  expectedRevision: number,
): { path: string; init: { method: 'PATCH'; body: string } } {
  return {
    path: `/admin/drivers/${encodeURIComponent(userId)}/approve`,
    init: { method: 'PATCH', body: JSON.stringify({ expectedRevision }) },
  };
}

/** 승인 대기 상자에서 본 신청 회차. 신청 정보가 없으면 0. */
export function driverApplicationRevision(driver: {
  driverApplication?: { revision?: unknown } | null;
}): number {
  const revision = driver.driverApplication?.revision;
  return typeof revision === 'number' && Number.isInteger(revision) && revision > 0 ? revision : 0;
}

function isApplicationChanged(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { status?: unknown; code?: unknown };
  return record.status === 409 && record.code === DRIVER_APPLICATION_CHANGED_CODE;
}

/**
 * runAdminCommand와 같은 순서(missingToken → invoke → classify → reload → resolve)에,
 * 신청 회차 충돌이면 목록을 다시 읽고 "신청 내용이 바뀌었어요" 거절로 돌려주는 분기를 더한다.
 */
export async function executeDriverApprove(options: {
  invoke: () => Promise<void>;
  reload: () => Promise<string | null>;
  missingToken?: boolean;
}): Promise<AdminCommandOutcome> {
  if (options.missingToken) return missingTokenOutcome();
  try {
    await options.invoke();
  } catch (error) {
    if (isApplicationChanged(error)) {
      await options.reload();
      return { kind: 'rejected', status: 409, message: DRIVER_APPLICATION_CHANGED_MESSAGE };
    }
    return classifyAdminCommandError(error);
  }
  return resolveConfirmedOutcome(await options.reload());
}
