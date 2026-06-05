import { toDateStrKST } from '@greenhub/shared';
import type { AdminDriver, DriverStatus } from '@/hooks/useAdmin';

export type DriverAction = 'approve' | 'suspend' | 'unsuspend';

type DriverActionMeta = {
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: string;
  successMessage: string;
  buttonLabel: string;
  buttonColor: string;
  buttonVariant?: 'light';
};

export interface PendingAction {
  userId: string;
  action: DriverAction;
}

// 액션별 ConfirmModal 문구/색 — 승인·정지·해제.
export const ACTION_META: Record<DriverAction, DriverActionMeta> = {
  approve: {
    title: '드라이버 승인',
    message: '이 드라이버를 승인하시겠습니까?',
    confirmLabel: '승인',
    confirmColor: 'green',
    successMessage: '드라이버를 승인했습니다. 승인 완료 탭에서 확인할 수 있습니다.',
    buttonLabel: '승인',
    buttonColor: 'green',
  },
  suspend: {
    title: '드라이버 정지',
    message: '이 드라이버를 정지하시겠습니까?',
    confirmLabel: '정지',
    confirmColor: 'red',
    successMessage: '드라이버를 정지했습니다. 정지됨 탭에서 확인할 수 있습니다.',
    buttonLabel: '정지',
    buttonColor: 'red',
    buttonVariant: 'light',
  },
  unsuspend: {
    title: '드라이버 정지 해제',
    message: '정지를 해제하시겠습니까?',
    confirmLabel: '해제',
    confirmColor: 'gray',
    successMessage: '드라이버 정지를 해제했습니다. 승인 완료 탭에서 확인할 수 있습니다.',
    buttonLabel: '정지 해제',
    buttonColor: 'gray',
    buttonVariant: 'light',
  },
};

export const STATUS_TABS: { key: DriverStatus; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'pending', label: '승인 대기' },
  { key: 'approved', label: '승인 완료' },
  { key: 'suspended', label: '정지됨' },
];

export function filterDrivers(drivers: AdminDriver[], keyword: string): AdminDriver[] {
  const query = keyword.trim().toLowerCase();
  if (!query) return drivers;

  return drivers.filter((driver) =>
    [driver.name, driver.email, driver.phone].some((value) => value?.toLowerCase().includes(query)),
  );
}

export function getDriverEmptyMessage(
  source: AdminDriver[],
  filtered: AdminDriver[],
): string | undefined {
  if (source.length > 0 && filtered.length === 0) return '검색 결과가 없습니다.';
  return undefined;
}

export function getDriverActions(driver: AdminDriver): DriverAction[] {
  const isSuspended = !!driver.suspended;
  if (isSuspended) return ['unsuspend'];
  if (!driver.driverApproved) return ['approve', 'suspend'];
  return ['suspend'];
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (!value || typeof value !== 'object') return null;

  const record = value as {
    _seconds?: number;
    seconds?: number;
    toDate?: () => Date;
  };
  if (typeof record.toDate === 'function') return record.toDate();
  const seconds = record._seconds ?? record.seconds;
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}

export function formatDriverCreatedAt(value: unknown): string {
  const date = toDate(value);
  return date ? toDateStrKST(date) : '-';
}

export function formatDriverContact(driver: AdminDriver): string {
  return driver.phone?.trim() || '미등록';
}

export function formatDriverVehicle(driver: AdminDriver): string {
  const parts = [driver.vehicleType, driver.vehicleNumber]
    .map((value) => value?.trim())
    .filter(Boolean);
  return parts.length > 0 ? `차량 ${parts.join(' · ')}` : '차량 정보 미등록';
}
