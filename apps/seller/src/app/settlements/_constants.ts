// 정산 상태 타입·라벨·색 SSOT = @greenhub/shared (F-1/S4). 셀러 로컬 정의 제거 후 re-export.
export { STATUS_LABEL, STATUS_COLOR } from '@greenhub/shared';
export type { SettlementStatus } from '@greenhub/shared';
import type { SettlementStatus } from '@greenhub/shared';

export type SettlementTab = 'daily' | 'period' | 'orders';

export interface Settlement {
  id: string;
  orderId: string;
  totalAmount: number;
  platformFee: number;
  netAmount: number;
  status: SettlementStatus;
  settledAt: { _seconds: number };
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
