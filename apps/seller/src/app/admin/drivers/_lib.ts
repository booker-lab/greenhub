import type { AdminDriver, DriverStatus } from '@/hooks/useAdmin';

export type DriverAction = 'approve' | 'suspend' | 'unsuspend';

export interface PendingAction {
  userId: string;
  action: DriverAction;
}

// 액션별 ConfirmModal 문구/색 — 승인·정지·해제.
export const ACTION_META: Record<
  DriverAction,
  { title: string; message: string; confirmLabel: string; confirmColor: string }
> = {
  approve: {
    title: '드라이버 승인',
    message: '이 드라이버를 승인하시겠습니까?',
    confirmLabel: '승인',
    confirmColor: 'green',
  },
  suspend: {
    title: '드라이버 정지',
    message: '이 드라이버를 정지하시겠습니까?',
    confirmLabel: '정지',
    confirmColor: 'red',
  },
  unsuspend: {
    title: '드라이버 정지 해제',
    message: '정지를 해제하시겠습니까?',
    confirmLabel: '해제',
    confirmColor: 'gray',
  },
};

export const STATUS_TABS: { value: DriverStatus; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'pending', label: '승인 대기' },
  { value: 'approved', label: '승인 완료' },
  { value: 'suspended', label: '정지됨' },
];

// 탭별 드라이버 필터 — 승인/정지 상태 조합.
export function filterByTab(drivers: AdminDriver[], tab: DriverStatus): AdminDriver[] {
  if (tab === 'pending') return drivers.filter((d) => !d.driverApproved && !d.suspended);
  if (tab === 'approved') return drivers.filter((d) => d.driverApproved && !d.suspended);
  if (tab === 'suspended') return drivers.filter((d) => d.suspended);
  return drivers;
}
