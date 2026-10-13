import type { OrderOperationIssue } from '@/app/orders/[id]/operation-issues';

/** 서버 `ResolveOperationIssueDto`와 같은 상한. */
export const MANUAL_RESOLVE_MEMO_MAX_LENGTH = 200;

/**
 * 관리자만 닫는 유형. 서버 `apps/api/src/operations/dto/resolve-operation-issue.dto.ts`의
 * `ADMIN_ONLY_MANUAL_RESOLVE_TYPES`와 같은 목록이다(정산 보류를 푸는 기록, 고객 환불이 확정되지 않은 기록).
 */
export const ADMIN_ONLY_MANUAL_RESOLVE_TYPES: ReadonlySet<OrderOperationIssue['type']> = new Set<
  OrderOperationIssue['type']
>(['PROVIDER_REVERSAL_DETECTED', 'AUTO_REFUND_FAILED', 'FINALIZATION_REFUND_FAILED']);

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/;

export interface ManualResolution {
  actorId: string;
  actorRole: 'seller' | 'admin';
  memo: string;
  resolvedAt: string;
}

export type StoreOperationIssue = OrderOperationIssue & {
  /** 사람이 메모와 함께 닫은 기록의 경위. 자동으로 해결됐거나 열린 기록은 null. */
  resolution: ManualResolution | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTimestamp(value: unknown): string | null {
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (!isRecord(value)) return null;
  const seconds = value._seconds ?? value.seconds;
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds)) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** 메모를 서버가 받는 한 줄 문자열로 맞춘다(제어문자·줄바꿈은 공백으로). */
export function normalizeManualResolveMemo(value: string): string {
  return value.replace(/\p{Cc}+/gu, ' ').trim();
}

export function isValidManualResolveMemo(value: string): boolean {
  const memo = normalizeManualResolveMemo(value);
  return memo.length > 0 && memo.length <= MANUAL_RESOLVE_MEMO_MAX_LENGTH;
}

export function readManualResolution(value: unknown): ManualResolution | null {
  if (!isRecord(value) || value.method !== 'MANUAL') return null;
  const actorId =
    typeof value.actorId === 'string' && SAFE_IDENTIFIER_PATTERN.test(value.actorId)
      ? value.actorId
      : null;
  const actorRole =
    value.actorRole === 'seller' || value.actorRole === 'admin' ? value.actorRole : null;
  const memo = typeof value.memo === 'string' ? normalizeManualResolveMemo(value.memo) : '';
  const resolvedAt = readTimestamp(value.resolvedAt);
  if (!actorId || !actorRole || !memo || !resolvedAt) return null;
  return {
    actorId,
    actorRole,
    memo: memo.slice(0, MANUAL_RESOLVE_MEMO_MAX_LENGTH),
    resolvedAt,
  };
}

/**
 * 목록 응답의 `resolution`을 이미 검증한 기록에 붙인다. 기존 파서가 버린 기록은 다시 살리지 않고,
 * 열린 기록에는 해결 경위를 붙이지 않는다.
 */
export function attachManualResolutions(
  payload: unknown,
  issues: OrderOperationIssue[],
): StoreOperationIssue[] {
  const byId = new Map<string, unknown>();
  if (isRecord(payload) && Array.isArray(payload.items)) {
    for (const item of payload.items) {
      if (isRecord(item) && typeof item.id === 'string') byId.set(item.id, item.resolution);
    }
  }
  return issues.map((issue) => ({
    ...issue,
    resolution: issue.status === 'OPEN' ? null : readManualResolution(byId.get(issue.id)),
  }));
}

/** 이 화면에서 "해결로 닫기"를 보여 줄지. 최종 판단은 서버가 다시 한다. */
export function canManuallyResolve(issue: OrderOperationIssue, role: string | null | undefined) {
  if (issue.status !== 'OPEN') return false;
  if (role === 'admin') return true;
  if (role !== 'seller') return false;
  return !ADMIN_ONLY_MANUAL_RESOLVE_TYPES.has(issue.type);
}

export function manualResolverLabel(resolution: ManualResolution) {
  return resolution.actorRole === 'admin' ? '관리자' : '판매자';
}
