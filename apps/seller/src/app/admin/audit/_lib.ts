// 어드민 행동 기록(adminAuditLogs) 표시용 순수 함수. API 기록 종류는 apps/api의 AdminAuditAction과 맞춘다.
// ② 방향(design-direction.md §5 어드민 "금지"): 영어 필드 이름·enum("status: pending → approved")을 그대로 보여 주지 않는다.
// 칸 이름과 상태 값은 각 화면의 라벨 SSOT에서 옮겨 쓴다.
import { POST_DELIVERY_REFUND_REASON_LABEL } from '@greenhub/shared';
import { formatAdminDateTime } from '../_components/adminFormat';
import { STATUS_LABEL as ORDER_STATUS_LABEL } from '../orders/_lib';
import { ADMIN_SETTLEMENT_STATUS_LABEL } from '../settlements/_lib';
import { STATUS_LABEL as STORE_STATUS_LABEL } from '../stores/_lib';

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
  'admin.store.archived': '판매자 정리',
  'admin.store.restored': '판매자 복구',
  'admin.user.suspended': '소비자 정지',
  'admin.user.unsuspended': '소비자 정지 해제',
  'admin.driver.approved': '기사 승인',
  'admin.driver.suspended': '기사 정지',
  'admin.driver.unsuspended': '기사 정지 해제',
  'admin.order.force_refunded': '강제 환불',
  'admin.order.post_delivery_refunded': '배송 후 환불',
  'admin.settlement.paid': '정산 지급',
  'admin.banner.updated': '배너 수정',
  'admin.partner_inquiry.contacted': '입점 문의 연락 표시',
  'admin.partner_inquiry.deleted': '입점 문의 삭제',
  'store.payout_account.updated': '정산 계좌 변경',
  'store.option_stock.created': '옵션 재고 추가',
  'store.option_stock.updated': '옵션 재고 변경',
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
  return ACTION_LABEL[action] ?? '기타 기록';
}

/** 대상 종류(판매자·주문…). 모르는 종류는 "기타"로 쓰고 원래 값은 보이지 않는다. */
export function targetTypeLabel(targetType: string): string {
  return TARGET_LABEL[targetType] ?? '기타';
}

/**
 * 대상 식별 값 — 잘라 쓰지 않고 전체를 보여 준다(design-direction.md §5 "식별").
 * 배너는 하나뿐이라 식별 값을 쓰지 않는다(null).
 */
export function targetIdLabel(log: Pick<AdminAuditLog, 'targetType' | 'targetId'>): string | null {
  if (log.targetType === 'banner') return null;
  return log.targetId;
}

/** 대상 한 줄(종류 + 전체 식별 값). */
export function targetLabel(log: Pick<AdminAuditLog, 'targetType' | 'targetId'>): string {
  const id = targetIdLabel(log);
  return id ? `${targetTypeLabel(log.targetType)} ${id}` : targetTypeLabel(log.targetType);
}

// 칸 이름 — API가 before/after에 남기는 키(admin.service·payout-accounts·option-stocks·engagement).
const FIELD_LABEL: Record<string, string> = {
  commissionRate: '수수료율',
  status: '상태',
  hadRecords: '주문·정산 기록',
  suspended: '정지',
  driverApproved: '승인',
  recoveryRequired: '판매자 회수',
  recoveryAmount: '회수할 금액',
  reasonCode: '환불 사유',
  contacted: '연락',
  bankName: '은행',
  accountNumberLast4: '계좌 끝 4자리',
  name: '이름',
  stockQuantity: '출력 수량',
  remainingQuantity: '남은 수량',
  imageUrl: '배너 사진',
  tagText: '태그 글자',
  headline: '제목',
  subText: '보조 글',
  cta1: '첫째 버튼',
  cta2: '둘째 버튼',
  isActive: '배너 노출',
};

// 사람이 읽을 뜻이 없는 키(내부 식별 값)는 바뀐 내용에서 뺀다.
const HIDDEN_FIELDS = new Set(['stockId']);

/** 참·거짓 칸의 뜻 — [거짓, 참]. 정하지 않은 칸은 예·아니오. */
const BOOLEAN_LABEL: Record<string, [string, string]> = {
  suspended: ['정상', '정지'],
  driverApproved: ['승인 대기', '승인'],
  contacted: ['연락 전', '연락함'],
  isActive: ['숨김', '노출'],
  hadRecords: ['없음', '있음'],
  recoveryRequired: ['필요 없음', '필요'],
};

function statusLabel(targetType: string | undefined, value: string): string {
  const table: Record<string, string> =
    targetType === 'store'
      ? STORE_STATUS_LABEL
      : targetType === 'order'
        ? ORDER_STATUS_LABEL
        : targetType === 'settlement'
          ? ADMIN_SETTLEMENT_STATUS_LABEL
          : {};
  return table[value] ?? '다른 상태';
}

function formatValue(key: string, value: unknown, targetType?: string): string {
  if (value === null || value === undefined || value === '') return '없음';
  if (key === 'commissionRate' && typeof value === 'number') {
    return `${Math.round(value * 1000) / 10}%`;
  }
  if (key === 'recoveryAmount' && typeof value === 'number') {
    return `${value.toLocaleString('ko-KR')}원`;
  }
  if (key === 'status' && typeof value === 'string') return statusLabel(targetType, value);
  if (key === 'reasonCode' && typeof value === 'string') {
    return (POST_DELIVERY_REFUND_REASON_LABEL as Record<string, string>)[value] ?? '기타';
  }
  if (typeof value === 'boolean') {
    const labels = BOOLEAN_LABEL[key];
    if (labels) return value ? labels[1] : labels[0];
    return value ? '예' : '아니오';
  }
  if (typeof value === 'object') return '변경됨';
  return String(value);
}

/** 바뀐 값을 "칸: 이전 → 이후" 줄로 만든다. 값이 같은 칸과 내부 식별 칸은 뺀다. */
export function describeChanges(
  log: Pick<AdminAuditLog, 'before' | 'after'> & { targetType?: string },
): string[] {
  const after = log.after ?? {};
  const before = log.before ?? {};
  return Object.keys(after)
    .filter((key) => !HIDDEN_FIELDS.has(key))
    .filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map(
      (key) =>
        `${FIELD_LABEL[key] ?? '기타 항목'}: ${formatValue(key, before[key], log.targetType)} → ${formatValue(key, after[key], log.targetType)}`,
    );
}

/** 기록 시각 — 한국 시간 "2026-10-21 00:30". 잘못된 값은 빈 문자열. */
export function formatLoggedAt(iso: string): string {
  return formatAdminDateTime(iso) ?? '';
}
