export type SettlementTab = 'daily' | 'period' | 'orders';
export type SettlementStatus = 'pending' | 'confirmed' | 'paid' | 'cancelled';

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

export const STATUS_LABEL: Record<SettlementStatus, string> = {
  pending: '정산 대기',
  confirmed: '확정',
  paid: '지급 완료',
  cancelled: '취소',
};

export const STATUS_COLOR: Record<SettlementStatus, string> = {
  pending: 'yellow',
  confirmed: 'blue',
  paid: 'green',
  cancelled: 'red',
};

export const TABS: { key: SettlementTab; label: string }[] = [
  { key: 'daily', label: '일별 요약' },
  { key: 'period', label: '기간별 조회' },
  { key: 'orders', label: '주문별 상세' },
];
