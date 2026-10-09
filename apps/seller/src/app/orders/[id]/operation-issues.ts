import type {
  OperationIssueActionType,
  OperationIssueSeverity,
  OperationIssueStatus,
  OperationIssueType,
} from '@greenhub/shared';

const ISSUE_TYPES = new Set<OperationIssueType>([
  'PAYMENT_LOOKUP_FAILED',
  'AUTO_REFUND_FAILED',
  'CUSTOMER_NOTICE_FAILED',
  'REDELIVERY_FAILED',
  'RETENTION_DELETE_FAILED',
  // 서버가 critical로 남기는 결과 불명확 기록. 목록에서 빠지면 운영자가 볼 수 없다.
  'FINALIZATION_REFUND_FAILED',
  'DELIVERY_PHOTO_RECONCILIATION_REQUIRED',
]);

export const ISSUE_LABELS: Record<OperationIssueType, string> = {
  PAYMENT_LOOKUP_FAILED: '결제 조회 확인',
  AUTO_REFUND_FAILED: '환불 재시도 필요',
  CUSTOMER_NOTICE_FAILED: '고객 연락 실패',
  REDELIVERY_FAILED: '재배송 분쟁 기록',
  RETENTION_DELETE_FAILED: '보관 파기 확인',
  FINALIZATION_REFUND_FAILED: '환불 결과 확인',
  DELIVERY_PHOTO_RECONCILIATION_REQUIRED: '배송 사진 확인',
};

export const ISSUE_DESCRIPTIONS: Record<OperationIssueType, string> = {
  PAYMENT_LOOKUP_FAILED: '결제 조회 결과를 서버에서 확인 중인 기록입니다.',
  AUTO_REFUND_FAILED: '자동 환불이 완료되지 않아 서버 재시도가 필요한 기록입니다.',
  CUSTOMER_NOTICE_FAILED: '알림톡과 문자 대체 발송이 모두 실패한 연락 기록입니다.',
  REDELIVERY_FAILED: '유료 재배송까지 실패해 자동 환불 판단 없이 남긴 분쟁 기록입니다.',
  RETENTION_DELETE_FAILED: '보관 객체 파기 실패로 관리자 확인이 필요한 기록입니다.',
  FINALIZATION_REFUND_FAILED:
    '결제 확정 중 환불 요청 결과를 확정하지 못했습니다. 재시도하지 말고 PortOne 콘솔에서 환불 여부를 확인하세요.',
  DELIVERY_PHOTO_RECONCILIATION_REQUIRED:
    '배송 사진 저장 결과를 자동으로 확정하지 못했습니다. 사진과 주문 배송 상태를 확인하세요.',
};
const ISSUE_STATUSES = new Set<OperationIssueStatus>(['OPEN', 'RESOLVED', 'DISMISSED']);
const ISSUE_SEVERITIES = new Set<OperationIssueSeverity>(['info', 'warning', 'critical']);
const ACTION_TYPES = new Set<OperationIssueActionType>(['RETRY_REFUND', 'RESEND_SMS']);
const ACTION_STATUSES = new Set(['SUCCEEDED', 'FAILED']);
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/;
const SAFE_STATE_FIELDS = ['orderStatus', 'paymentStatus'] as const;
const SAFE_SNAPSHOT_FIELDS = [...SAFE_STATE_FIELDS, 'failureStage', 'templateCode'] as const;

export interface OperationStateSnapshot {
  orderStatus: string | null;
  paymentStatus: string | null;
}

export interface OperationSnapshot extends OperationStateSnapshot {
  failureStage: string | null;
  templateCode: string | null;
}

export interface OrderOperationAction {
  actorId: string;
  actionType: OperationIssueActionType;
  performedAt: string;
  status: 'SUCCEEDED' | 'FAILED';
  failureReason?: string;
}

export interface OrderOperationIssue {
  id: string;
  storeId: string;
  orderId: string;
  paymentId: string | null;
  type: OperationIssueType;
  status: OperationIssueStatus;
  severity: OperationIssueSeverity;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  latestSnapshot: OperationSnapshot;
  currentState: OperationStateSnapshot | null;
  actions: OrderOperationAction[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readIdentifier(value: unknown): string | null {
  return typeof value === 'string' && SAFE_IDENTIFIER_PATTERN.test(value) ? value : null;
}

function readNullableIdentifier(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return readIdentifier(value) ?? undefined;
}

function readSafeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\r\n\t]/g, ' ').trim();
  return text.length > 0 && text.length <= maxLength ? text : null;
}

function readTimestamp(value: unknown): string | null {
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (!isRecord(value)) return null;
  const seconds = value._seconds ?? value.seconds;
  const nanoseconds = value._nanoseconds ?? value.nanoseconds ?? 0;
  if (
    typeof seconds !== 'number' ||
    !Number.isSafeInteger(seconds) ||
    typeof nanoseconds !== 'number' ||
    !Number.isSafeInteger(nanoseconds) ||
    nanoseconds < 0 ||
    nanoseconds >= 1_000_000_000
  ) {
    return null;
  }
  const date = new Date(seconds * 1000 + Math.floor(nanoseconds / 1_000_000));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readNullableTimestamp(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return readTimestamp(value) ?? undefined;
}

function readSnapshot<T extends readonly string[]>(
  value: unknown,
  fields: T,
): { [K in T[number]]: string | null } {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(fields.map((field) => [field, readSafeText(source[field], 80)])) as {
    [K in T[number]]: string | null;
  };
}

function readAction(value: unknown): OrderOperationAction | null {
  if (!isRecord(value)) return null;
  const actorId = readIdentifier(value.actorId);
  const performedAt = readTimestamp(value.performedAt);
  if (
    !actorId ||
    typeof value.actionType !== 'string' ||
    !ACTION_TYPES.has(value.actionType as OperationIssueActionType) ||
    typeof value.status !== 'string' ||
    !ACTION_STATUSES.has(value.status) ||
    !performedAt
  ) {
    return null;
  }
  const failureReason =
    value.status === 'FAILED' ? readSafeText(value.failureReason, 300) : undefined;
  if (value.status === 'FAILED' && !failureReason) return null;
  return {
    actorId,
    actionType: value.actionType as OperationIssueActionType,
    performedAt,
    status: value.status as 'SUCCEEDED' | 'FAILED',
    ...(failureReason ? { failureReason } : {}),
  };
}

export function readOperationIssue(value: unknown): OrderOperationIssue | null {
  if (!isRecord(value)) return null;
  const id = readIdentifier(value.id);
  const storeId = readIdentifier(value.storeId);
  const orderId = readIdentifier(value.orderId);
  const paymentId = readNullableIdentifier(value.paymentId);
  const createdAt = readTimestamp(value.createdAt);
  const updatedAt = readTimestamp(value.updatedAt);
  const resolvedAt = readNullableTimestamp(value.resolvedAt);
  if (
    !id ||
    !storeId ||
    !orderId ||
    paymentId === undefined ||
    typeof value.type !== 'string' ||
    !ISSUE_TYPES.has(value.type as OperationIssueType) ||
    typeof value.status !== 'string' ||
    !ISSUE_STATUSES.has(value.status as OperationIssueStatus) ||
    typeof value.severity !== 'string' ||
    !ISSUE_SEVERITIES.has(value.severity as OperationIssueSeverity) ||
    !createdAt ||
    !updatedAt ||
    resolvedAt === undefined ||
    !Array.isArray(value.actions)
  ) {
    return null;
  }
  const actions = value.actions.map(readAction);
  if (actions.some((action) => action === null)) return null;
  return {
    id,
    storeId,
    orderId,
    paymentId,
    type: value.type as OperationIssueType,
    status: value.status as OperationIssueStatus,
    severity: value.severity as OperationIssueSeverity,
    createdAt,
    updatedAt,
    resolvedAt,
    latestSnapshot: readSnapshot(value.latestSnapshot, SAFE_SNAPSHOT_FIELDS),
    currentState: isRecord(value.currentState)
      ? readSnapshot(value.currentState, SAFE_STATE_FIELDS)
      : null,
    actions: actions as OrderOperationAction[],
  };
}

export function readOperationIssueList(
  value: unknown,
  expected: { storeId: string; orderId: string },
): OrderOperationIssue[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('운영 기록 응답을 확인할 수 없습니다.');
  }
  return value.items
    .map(readOperationIssue)
    .filter(
      (issue): issue is OrderOperationIssue =>
        issue !== null && issue.storeId === expected.storeId && issue.orderId === expected.orderId,
    )
    .sort((left, right) => {
      if (left.status === 'OPEN' && right.status !== 'OPEN') return -1;
      if (left.status !== 'OPEN' && right.status === 'OPEN') return 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
}

function compareIssues(left: OrderOperationIssue, right: OrderOperationIssue) {
  if (left.status === 'OPEN' && right.status !== 'OPEN') return -1;
  if (left.status !== 'OPEN' && right.status === 'OPEN') return 1;
  if (left.status === 'OPEN' && left.severity !== right.severity) {
    if (left.severity === 'critical') return -1;
    if (right.severity === 'critical') return 1;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

/** 가게 전체 운영 기록: 열린 기록 → critical 우선 → 최근 순. 다른 가게 기록은 버린다. */
export function readStoreOperationIssueList(
  value: unknown,
  expectedStoreId: string,
): OrderOperationIssue[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('운영 기록 응답을 확인할 수 없습니다.');
  }
  return value.items
    .map(readOperationIssue)
    .filter(
      (issue): issue is OrderOperationIssue => issue !== null && issue.storeId === expectedStoreId,
    )
    .sort(compareIssues);
}

export function getAllowedOperationAction(
  issue: OrderOperationIssue,
): OperationIssueActionType | null {
  if (issue.status !== 'OPEN') return null;
  if (issue.type === 'AUTO_REFUND_FAILED') return 'RETRY_REFUND';
  if (issue.type === 'CUSTOMER_NOTICE_FAILED') return 'RESEND_SMS';
  return null;
}
