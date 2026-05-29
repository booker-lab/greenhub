import type { SettlementStatus } from '@greenhub/shared';
import { SETTLEMENT_STATUSES, STATUS_LABEL } from '@greenhub/shared';

export type SettlementFilterKey = 'all' | SettlementStatus;

export const SETTLEMENT_FILTER_TABS: { key: SettlementFilterKey; label: string }[] = [
  { key: 'all', label: '전체' },
  ...SETTLEMENT_STATUSES.map((status) => ({ key: status, label: STATUS_LABEL[status] })),
];
