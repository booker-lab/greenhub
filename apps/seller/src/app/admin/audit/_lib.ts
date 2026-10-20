// 어드민 행동 기록(adminAuditLogs) 표시용 순수 함수. API 기록 종류는 apps/api의 AdminAuditAction과 맞춘다.

export interface AdminAuditLog {
  id: string;
  action: string;
  actorId: string;
  targetType: string;
  targetId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}

export const ACTION_LABEL: Record<string, string> = {
  'admin.store.commission_changed': '수수료 변경',
  'admin.store.archived': '판매자 치우기',
  'admin.store.restored': '판매자 복구',
  'admin.user.suspended': '소비자 정지',
  'admin.user.unsuspended': '소비자 정지 해제',
  'admin.driver.approved': '기사 승인',
  'admin.driver.suspended': '기사 정지',
  'admin.driver.unsuspended': '기사 정지 해제',
  'admin.order.force_refunded': '강제 환불',
  'admin.settlement.paid': '정산 지급',
  'admin.banner.updated': '배너 수정',
  'admin.partner_inquiry.contacted': '입점 문의 연락 표시',
  'admin.partner_inquiry.deleted': '입점 문의 삭제',
};

const TARGET_LABEL: Record<string, string> = {
  store: '판매자',
  user: '소비자',
  driver: '기사',
  order: '주문',
  settlement: '정산',
  banner: '배너',
  partner_inquiry: '입점 문의',
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

/** 대상 표시. 12자를 넘는 문서 ID는 앞 8자만 보여 준다. */
export function targetLabel(log: Pick<AdminAuditLog, 'targetType' | 'targetId'>): string {
  const type = TARGET_LABEL[log.targetType] ?? log.targetType;
  const id = log.targetId.length > 12 ? `${log.targetId.slice(0, 8)}…` : log.targetId;
  return `${type} ${id}`;
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '없음';
  if (key === 'commissionRate' && typeof value === 'number') {
    return `${Math.round(value * 1000) / 10}%`;
  }
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  if (typeof value === 'object') return '변경됨';
  return String(value);
}

/** 바뀐 값을 "칸: 이전 → 이후" 줄로 만든다. 값이 같은 칸은 뺀다. */
export function describeChanges(log: Pick<AdminAuditLog, 'before' | 'after'>): string[] {
  const after = log.after ?? {};
  const before = log.before ?? {};
  return Object.keys(after)
    .filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map((key) => `${key}: ${formatValue(key, before[key])} → ${formatValue(key, after[key])}`);
}

export function formatLoggedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
}
