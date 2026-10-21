// 어드민 정산 화면 공용 유틸 (F-2/S5).
import { SETTLEMENT_STATUSES, STATUS_LABEL, type SettlementStatus } from '@greenhub/shared';
import type {
  AdminPayoutAccount,
  AdminSettlement,
  AdminSettlementHoldReason,
} from '@/hooks/useAdmin';

/**
 * 정산일시 표기 포매터 — 브라우저 시간대와 무관하게 항상 KST(Asia/Seoul)로 표시.
 * shared `toDateStrKST`는 YYYY-MM-DD만 지원하므로 시·분 표시는 timeZone 지정으로 해결.
 */
const SETTLED_AT_FORMAT_KST = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * 정산일시 표기 — settledAt 직렬화 형태가 호출 경로마다 다름(#CL-46).
 * API TimestampInterceptor는 ISO 문자열, Firestore raw 직렬화는 `{ _seconds }`.
 * 양쪽 모두 방어적으로 파싱하고, 불가하면 '-'.
 */
export function toDateStr(ts: unknown): string {
  let date: Date | null = null;
  if (typeof ts === 'string') {
    const d = new Date(ts);
    date = Number.isNaN(d.getTime()) ? null : d;
  } else if (ts && typeof ts === 'object' && '_seconds' in ts) {
    date = new Date((ts as { _seconds: number })._seconds * 1000);
  }
  if (!date || Number.isNaN(date.getTime())) return '-';
  return SETTLED_AT_FORMAT_KST.format(date);
}

export function toKRW(n: number): string {
  return `₩${n.toLocaleString('ko-KR')}`;
}

// 정산 상태 탭 — '전체' + shared 정산 상태 4개(판매자 정산 #245와 같은 방식, 라벨은 shared SSOT).
export type AdminSettlementFilterKey = 'all' | SettlementStatus;

export const ADMIN_SETTLEMENT_FILTER_TABS: { key: AdminSettlementFilterKey; label: string }[] = [
  { key: 'all', label: '전체' },
  ...SETTLEMENT_STATUSES.map((status) => ({ key: status, label: STATUS_LABEL[status] })),
];

export const HOLD_REASON_LABEL: Record<AdminSettlementHoldReason, string> = {
  PROVIDER_REVERSAL: '지급 보류 · 결제사 취소·분쟁 확인 중',
};

/** 가게 표시 — 이름이 있으면 이름, 없으면 가게 ID 앞 8자. */
export function storeLabel(s: Pick<AdminSettlement, 'storeId' | 'storeName'>): string {
  return s.storeName || `${s.storeId.slice(0, 8)}…`;
}

/** 주문 표시 — 주문번호가 없는 옛 정산은 주문 ID. */
export function orderLabel(s: Pick<AdminSettlement, 'orderId' | 'orderNumber'>): string {
  return s.orderNumber || s.orderId;
}

/** 정산 계좌 한 줄. 지급 확인창에서 관리자가 입금할 때 본다. */
export function describePayoutAccount(account: AdminPayoutAccount | null | undefined): string {
  if (!account) return '정산 계좌: 미등록 — 판매자에게 앱 설정 > 정산 계좌 등록을 요청하세요.';
  return `입금 계좌: ${account.bankName} ${account.accountNumber} (예금주 ${account.accountHolder})`;
}

/** 가게 선택 목록 — 이름순, 이름이 없으면 ID. */
export function toStoreOptions(stores: Array<{ id: string; name?: string | null }>) {
  return stores
    .map((store) => ({ value: store.id, label: store.name || store.id }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}

/**
 * 지급 확인창 문구 — 어느 가게·주문에 얼마를 어느 계좌로 지급 완료 표시하는지 보여 준다.
 * 가게 이름이 없으면 가게 ID 전체, 주문번호가 없는 옛 정산은 주문 ID를 보인다.
 */
export function describePayConfirm(
  s: Pick<
    AdminSettlement,
    'storeId' | 'storeName' | 'orderId' | 'orderNumber' | 'netAmount' | 'payoutAccount'
  >,
): string {
  return [
    s.storeName ? `가게: ${s.storeName}` : `가게 ID: ${s.storeId}`,
    s.orderNumber ? `주문번호: ${s.orderNumber}` : `주문 ID: ${s.orderId}`,
    `지급액: ${toKRW(s.netAmount)}`,
    describePayoutAccount(s.payoutAccount),
    '',
    '이 계좌로 입금한 뒤 지급 완료 처리하시겠습니까?',
  ].join('\n');
}
