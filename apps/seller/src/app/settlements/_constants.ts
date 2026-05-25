// 정산 상태 타입·라벨·색 SSOT = @greenhub/shared (F-1/S4). 셀러 로컬 정의 제거 후 re-export.
export { STATUS_LABEL, STATUS_COLOR, SETTLEMENT_STATUSES } from '@greenhub/shared';
export type { SettlementStatus } from '@greenhub/shared';
import { SETTLEMENT_STATUSES, STATUS_LABEL } from '@greenhub/shared';
import type { SettlementStatus } from '@greenhub/shared';

export type SettlementTab = 'daily' | 'period' | 'orders';

// [주문별 상세] status 필터 탭 키. 'all'(전체) + SSOT 4상태. 신규 라벨/색 정의 0 (T1).
export type SettlementFilterKey = 'all' | SettlementStatus;

export const SETTLEMENT_FILTER_TABS: { key: SettlementFilterKey; label: string }[] = [
  { key: 'all', label: '전체' },
  ...SETTLEMENT_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s] })),
];

export interface Settlement {
  id: string;
  orderId: string;
  totalAmount: number;
  platformFee: number;
  netAmount: number;
  status: SettlementStatus;
  // settledAt 직렬화 형태가 호출 경로마다 다름(#CL-46): API TimestampInterceptor=ISO 문자열,
  // Firestore raw 직렬화=`{ _seconds }`. toDateStr/toISO가 둘 다 처리.
  settledAt: string | { _seconds: number };
}

export interface Summary {
  date: string;
  count: number;
  totalAmount: number;
  totalPlatformFee: number;
  totalNetAmount: number;
  byStatus: Record<SettlementStatus, number>;
}

export const TABS: { key: SettlementTab; label: string }[] = [
  { key: 'daily', label: '일별 요약' },
  { key: 'period', label: '기간별 조회' },
  { key: 'orders', label: '주문별 상세' },
];
