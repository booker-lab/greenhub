/**
 * Admin command outcome / reconciliation 순수 계약.
 * `useAdmin.ts`의 single semantic owner가 공유하는 판정이며,
 * vitest에서 `@/` alias 없이 직접 검증할 수 있도록 framework 의존성을 두지 않는다.
 *
 * Collapse 방지 원칙:
 * - 서버 non-2xx 확정 거부는 reason/status를 보존한다 (ApiError message를 버리지 않음).
 * - transport/network·5xx 불확정은 "실패했으니 다시 누르세요"로 축약하지 않고
 *   상태 재확인을 우선하며 고위험 command 자동 재전송을 금지한다.
 * - 2xx 확인 + authoritative reload 성공만 reconciled success다.
 * - 2xx 확인 + reload 실패는 command 실패로 되돌리지 않고
 *   "처리는 완료됐으나 최신 화면 확인 실패 + 수동 다시 조회 + 중복 실행 금지"로 표현한다.
 * - reload 실패는 기존 list error state에도 남는다 (본 파일은 copy만 제공하고
 *   실제 error state write는 `useAdminList.load`가 소유한다).
 */

export type AdminCommandOutcome =
  | { kind: 'confirmed'; reconciled: true }
  | { kind: 'confirmed'; reconciled: false; readError: string }
  | { kind: 'rejected'; status: number | null; message: string }
  | { kind: 'unknown'; message: string };

export interface AdminCommandPresentation {
  title: string;
  message: string;
  /** 같은 고위험 command를 바로 다시 실행하도록 유도해도 되는지. unknown/stale은 false. */
  allowCommandRetry: boolean;
  /** authoritative list 다시 조회가 필요한지. unknown/stale은 true. */
  needsReadRetry: boolean;
}

export const ADMIN_COMMAND_MISSING_TOKEN_MESSAGE =
  '인증 토큰이 없습니다. 다시 로그인해 주세요.';

const UNKNOWN_GUIDANCE =
  '요청이 서버에 전달됐는지 확인할 수 없습니다. 먼저 목록을 다시 조회해 상태를 확인하세요. 같은 작업을 바로 다시 실행하지 마세요.';

const STALE_GUIDANCE = '다시 조회해 최신 상태를 확인해 주세요. 같은 작업을 중복 실행하지 마세요.';

function isApiErrorLike(value: unknown): value is { status: number; message: string } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.status === 'number' && typeof record.message === 'string';
}

function readApiStatus(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  return typeof record.status === 'number' ? record.status : null;
}

function readErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim().length > 0) {
      return record.message;
    }
  }
  if (value instanceof Error && value.message.trim().length > 0) return value.message;
  return fallback;
}

/**
 * command invoke 단계에서 던져진 에러를 확정 거부(rejected) / 불확정(unknown)으로 분류한다.
 * - 4xx ApiError: 서버가 명확히 거부 — reason/status 보존.
 * - 5xx ApiError: 적용 여부가 불확정 — 서버 reason을 버리지 않되 unknown으로 취급.
 * - 그 외 transport/network/unknown: unknown으로 취급하고 재확인 우선 copy를 부여.
 */
export function classifyAdminCommandError(
  error: unknown,
): Extract<AdminCommandOutcome, { kind: 'rejected' } | { kind: 'unknown' }> {
  if (isApiErrorLike(error)) {
    const status = readApiStatus(error) ?? 0;
    const serverMessage = readErrorMessage(error, `요청이 거부됐습니다 (${status})`);
    if (status >= 500) {
      return {
        kind: 'unknown',
        message: `${serverMessage} — ${UNKNOWN_GUIDANCE}`,
      };
    }
    return { kind: 'rejected', status, message: serverMessage };
  }
  return { kind: 'unknown', message: UNKNOWN_GUIDANCE };
}

export function missingTokenOutcome(): Extract<AdminCommandOutcome, { kind: 'rejected' }> {
  return { kind: 'rejected', status: null, message: ADMIN_COMMAND_MISSING_TOKEN_MESSAGE };
}

/**
 * 2xx 확인 뒤 authoritative reload 결과를 outcome으로 결합한다.
 * - readError null: COMMAND CONFIRMED + RECONCILED.
 * - readError string: COMMAND CONFIRMED + RECONCILIATION FAILED.
 *   command를 실패로 되돌리지 않으며 readError를 보존한다.
 */
export function resolveConfirmedOutcome(
  readError: string | null,
): Extract<AdminCommandOutcome, { kind: 'confirmed' }> {
  if (readError === null) return { kind: 'confirmed', reconciled: true };
  return { kind: 'confirmed', reconciled: false, readError };
}

/**
 * mock/local focused regression용 오케스트레이션.
 * 실제 fetch를 수행하지 않고 주입된 invoke/reload 결과만으로 outcome을 판정한다.
 * `useAdmin.ts`의 runtime `runAdminCommand`와 동일한 순서를 공유한다:
 * missingToken → invoke → classify → reload → resolve.
 */
export async function executeAdminCommand(options: {
  invoke: () => Promise<void>;
  reload: () => Promise<string | null>;
  missingToken?: boolean;
}): Promise<AdminCommandOutcome> {
  if (options.missingToken) return missingTokenOutcome();
  try {
    await options.invoke();
  } catch (error) {
    return classifyAdminCommandError(error);
  }
  return resolveConfirmedOutcome(await options.reload());
}

/**
 * outcome을 UI notification copy + 재시도 가드로 변환하는 단일 소유자.
 * - rejected: 서버 reason 그대로 전달. command 재시도는 호출자가 의도적으로만 수행.
 * - unknown: 상태 재확인 우선, 고위험 command 자동/즉시 재전송 금지.
 * - confirmed+stale: "처리는 완료됐으나 확인 실패 + 수동 다시 조회 + 중복 금지".
 *   절대 `${actionLabel} 처리 실패` copy로 붕괴하지 않는다.
 * - confirmed+reconciled: 성공. 별도 경고 copy 없음.
 */
export function describeAdminCommandOutcome(
  outcome: AdminCommandOutcome,
  actionLabel: string,
): AdminCommandPresentation {
  if (outcome.kind === 'confirmed' && outcome.reconciled) {
    return {
      title: `${actionLabel} 처리 완료`,
      message: `${actionLabel} 처리가 완료됐습니다.`,
      allowCommandRetry: false,
      needsReadRetry: false,
    };
  }
  if (outcome.kind === 'confirmed') {
    return {
      title: `${actionLabel} 처리는 완료됐으나 목록 확인 실패`,
      message: `${actionLabel} 처리는 완료됐으나 최신 목록 확인에 실패했습니다 (${outcome.readError}). ${STALE_GUIDANCE}`,
      allowCommandRetry: false,
      needsReadRetry: true,
    };
  }
  if (outcome.kind === 'rejected') {
    return {
      title: `${actionLabel} 처리 실패`,
      message: outcome.message,
      allowCommandRetry: true,
      needsReadRetry: false,
    };
  }
  return {
    title: `${actionLabel} 결과를 확인할 수 없습니다`,
    message: outcome.message,
    allowCommandRetry: false,
    needsReadRetry: true,
  };
}
