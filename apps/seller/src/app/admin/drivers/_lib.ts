import type { ConfirmColor } from '@/components/ConfirmModal';
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
  { title: string; message: string; confirmLabel: string; confirmColor: ConfirmColor }
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

// ② 방향(design-direction.md §5 어드민 "기사"): 승인 대기는 표 위 요약 상자로 빼고, 표는 전체 · 활동 중 · 정지 탭이다.
export type DriverTableTab = 'all' | 'approved' | 'suspended';

export const DRIVER_TABLE_TABS: { value: DriverTableTab; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'approved', label: '활동 중' },
  { value: 'suspended', label: '정지' },
];

/** 승인 대기 — 아직 승인되지 않았고 정지되지 않은 기사. */
export function isPendingDriver(driver: AdminDriver): boolean {
  return !driver.driverApproved && !driver.suspended;
}

// 탭별 기사 필터 — 승인/정지 상태 조합. 'pending'은 요약 상자가 쓴다.
export function filterByTab(drivers: AdminDriver[], tab: DriverStatus): AdminDriver[] {
  if (tab === 'pending') return drivers.filter(isPendingDriver);
  if (tab === 'approved') return drivers.filter((d) => d.driverApproved && !d.suspended);
  if (tab === 'suspended') return drivers.filter((d) => d.suspended);
  // 표의 '전체'는 승인 대기를 뺀 기사(승인 대기는 위 요약 상자에 있다).
  return drivers.filter((d) => !isPendingDriver(d));
}

/** 신청한 지 며칠째인지 — 한국 날짜 기준. 오늘 신청이면 0. 날짜를 읽을 수 없으면 null. */
export function waitingDays(createdAt: Date | null, now: Date = new Date()): number | null {
  if (!createdAt) return null;
  const day = (d: Date) => Math.floor((d.getTime() + 9 * 60 * 60 * 1000) / 86_400_000);
  return Math.max(0, day(now) - day(createdAt));
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
