// 어드민 정산 화면 공용 유틸 (F-2/S5).
import { SETTLEMENT_STATUSES, type SettlementStatus } from '@greenhub/shared';
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

// 어드민 정산 상태 이름(design-direction.md §5 어드민 "정산"): pending은 "지급 대기"와 헷갈리지 않게 "회차 마감 전",
// 지급할 차례인 confirmed는 "지급 대기"로 쓴다. 판매자 화면 이름(shared STATUS_LABEL)은 바꾸지 않는다.
export const ADMIN_SETTLEMENT_STATUS_LABEL: Record<SettlementStatus, string> = {
  pending: '회차 마감 전',
  confirmed: '지급 대기',
  paid: '지급 완료',
  cancelled: '취소',
};

/** 상태 점의 색 — 끝난 상태(지급 완료·취소)는 회색, 나머지 검정. 문제(계좌 미등록·회수 필요)는 따로 빨강으로 쓴다. */
export function settlementStatusTone(status: SettlementStatus): 'done' | 'default' {
  return status === 'paid' || status === 'cancelled' ? 'done' : 'default';
}

// 정산 상태 탭 — '전체' + 정산 상태 4개. 상태별 건수 조회가 없어 탭에 숫자를 쓰지 않는다.
export type AdminSettlementFilterKey = 'all' | SettlementStatus;

export const ADMIN_SETTLEMENT_FILTER_TABS: { key: AdminSettlementFilterKey; label: string }[] = [
  { key: 'all', label: '전체' },
  ...(['confirmed', 'pending', 'paid', 'cancelled'] as const)
    .filter((status) => SETTLEMENT_STATUSES.includes(status))
    .map((status) => ({ key: status, label: ADMIN_SETTLEMENT_STATUS_LABEL[status] })),
];

/** 금액 표기 — "48,000원". */
export function toWon(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`;
}

/** 정산일 — 비교하는 열이라 KST `2026-11-28` 한 형식(D7 "날짜"). 읽을 수 없으면 null. */
export function toDateOnly(ts: unknown): string | null {
  let millis: number | null = null;
  if (typeof ts === 'string' && ts.trim() !== '') millis = new Date(ts).getTime();
  else if (ts && typeof ts === 'object' && '_seconds' in ts) {
    const seconds = (ts as { _seconds: unknown })._seconds;
    if (typeof seconds === 'number') millis = seconds * 1000;
  }
  if (millis === null || Number.isNaN(millis)) return null;
  const kst = new Date(millis + 9 * 60 * 60 * 1000);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`;
}

/** 계좌번호 가림 — 끝 4자리만 남기고 나머지 숫자를 *로 바꾼다(하이픈은 둔다). 전체 번호는 "복사"가 복사한다. */
export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, '').length;
  let seen = 0;
  return accountNumber.replace(/\d/g, (d) => {
    seen += 1;
    return seen > digits - 4 ? d : '*';
  });
}

/**
 * 가게별 묶음 — 불러온 정산 행을 가게 단위로 모은다(첫 등장 순서 유지).
 * 묶음 합계는 이체할 돈만 센다: 그 가게의 불러온 지급 대기(confirmed) 행의 합이다. 지급 완료·취소·회차 마감 전 행은 섞지 않는다.
 */
export interface SettlementStoreGroup {
  storeId: string;
  storeName: string;
  payoutAccount: AdminPayoutAccount | null;
  rows: AdminSettlement[];
  /** 지급 대기(confirmed) 행 수. */
  payableCount: number;
  totalAmount: number;
  platformFee: number;
  netAmount: number;
}

export function groupSettlementsByStore(rows: readonly AdminSettlement[]): SettlementStoreGroup[] {
  const groups = new Map<string, SettlementStoreGroup>();
  const named = new Set<string>();
  for (const row of rows) {
    let group = groups.get(row.storeId);
    if (!group) {
      group = {
        storeId: row.storeId,
        storeName: storeLabel(row),
        payoutAccount: null,
        rows: [],
        payableCount: 0,
        totalAmount: 0,
        platformFee: 0,
        netAmount: 0,
      };
      groups.set(row.storeId, group);
    }
    group.rows.push(row);
    // 이름·계좌가 없는 행(옛 정산, 지급 대상이 아닌 행)이 먼저 와도 같은 가게의 다른 행 값으로 채운다.
    if (row.storeName && !named.has(row.storeId)) {
      named.add(row.storeId);
      group.storeName = row.storeName;
    }
    group.payoutAccount ??= row.payoutAccount ?? null;
    if (row.status !== 'confirmed') continue;
    group.payableCount += 1;
    group.totalAmount += row.totalAmount;
    group.platformFee += row.platformFee;
    group.netAmount += row.netAmount;
  }
  return [...groups.values()];
}

/** 숫자 띠의 불러온 행 기준 칸 — 계좌가 없어 못 보내는 지급 대기, 결제사 취소 확인 중인 지급 보류. */
export function summarizeLoadedBlocks(rows: readonly AdminSettlement[]): {
  noAccount: { count: number; netAmount: number };
  held: { count: number; netAmount: number };
} {
  const noAccount = { count: 0, netAmount: 0 };
  const held = { count: 0, netAmount: 0 };
  for (const row of rows) {
    if (row.status !== 'confirmed') continue;
    if (row.holdReason) {
      held.count += 1;
      held.netAmount += row.netAmount;
    } else if (!row.payoutAccount) {
      noAccount.count += 1;
      noAccount.netAmount += row.netAmount;
    }
  }
  return { noAccount, held };
}

export const HOLD_REASON_LABEL: Record<AdminSettlementHoldReason, string> = {
  PROVIDER_REVERSAL: '지급 보류 · 결제사 취소·분쟁 확인 중',
};

/** 가게 표시 — 잘린 시스템 id를 보여 주지 않는다(D7 "식별"). 이름이 없으면 "이름 없는 가게". */
export function storeLabel(s: Pick<AdminSettlement, 'storeId' | 'storeName'>): string {
  return s.storeName || '이름 없는 가게';
}

/** 주문 표시 — 주문번호가 없는 옛 정산은 주문 ID. */
export function orderLabel(s: Pick<AdminSettlement, 'orderId' | 'orderNumber'>): string {
  return s.orderNumber || s.orderId;
}

/**
 * 지급 완료로 기록할 수 있는지. 확정(confirmed)이고 보류 사유가 없으며 정산 계좌가 있어야 한다.
 * 계좌 없이 다른 수단으로 지급하는 것은 허용하지 않는다(2026-10-30 사용자 결정). 서버 markAsPaid도 같은 조건으로 거절한다.
 */
export function canPay(
  s: Pick<AdminSettlement, 'status' | 'holdReason' | 'payoutAccount'>,
): boolean {
  return s.status === 'confirmed' && !s.holdReason && Boolean(s.payoutAccount);
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
    s.payoutAccount
      ? '이 계좌로 입금한 뒤 지급 완료 처리하시겠습니까?'
      : '입금할 계좌가 없어 지급 완료로 기록할 수 없습니다.',
  ].join('\n');
}
