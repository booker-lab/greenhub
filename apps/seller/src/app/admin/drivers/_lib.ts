import type { AdminDriver, DriverStatus } from '@/hooks/useAdmin';

export type DriverAction = 'approve' | 'suspend' | 'unsuspend';

export interface PendingAction {
  userId: string;
  /** 확인창에 보일 대상 — 다른 기사를 고르는 실수를 막는다. */
  name: string;
  email: string | null;
  action: DriverAction;
}

// 액션별 ConfirmModal 문구/색 — 승인·정지·정지 해제. 대상 표시는 describeDriverConfirm이 붙인다.
export const ACTION_META: Record<
  DriverAction,
  { title: string; message: string; confirmLabel: string; confirmColor: string }
> = {
  approve: {
    title: '드라이버 승인',
    message: '이 드라이버를 승인하시겠습니까?',
    confirmLabel: '승인',
    confirmColor: 'brand',
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
    confirmLabel: '정지 해제',
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

// Admin 드라이버 목록 read state — 조회 실패와 성공-empty의 구조적 구분.
// useAdminDrivers는 error/reload를 노출하지만 화면이 이를 소비하지 않으면
// 조회 실패가 빈 목록("드라이버가 없습니다.")으로 collapse된다.
// 분기 우선순위(loading > error > empty > results)를 순수 함수로 고정한다.
export type AdminDriversReadState = 'LOADING' | 'FETCH_ERROR' | 'EMPTY' | 'HAS_RESULTS';

export function getAdminDriversReadState(args: {
  loading: boolean;
  error: string | null;
  drivers: readonly unknown[];
}): AdminDriversReadState {
  if (args.loading) return 'LOADING';
  if (args.error !== null) return 'FETCH_ERROR';
  if (args.drivers.length === 0) return 'EMPTY';
  return 'HAS_RESULTS';
}

/** 확인창 본문 — 대상(이름·이메일) 줄 + 액션별 질문. 이름·이메일이 비면 자리표시자. */
export function describeDriverConfirm(
  pending: Pick<PendingAction, 'name' | 'email' | 'action'>,
): string {
  // 타입은 string이지만 옛 문서에 필드가 없을 수 있어 ?.로 방어한다.
  const name = pending.name?.trim() || '이름 없음';
  const email = pending.email?.trim();
  const who = email ? `${name} (${email})` : name;
  return `${who}\n${ACTION_META[pending.action].message}`;
}
