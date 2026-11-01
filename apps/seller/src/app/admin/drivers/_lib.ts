import type { AdminDriver, DriverStatus } from '@/hooks/useAdmin';
import { formatAdminDate } from '../_components/adminFormat';

export type DriverAction = 'approve' | 'suspend' | 'unsuspend';

export interface PendingAction {
  userId: string;
  /** 확인창에 보일 대상 — 다른 기사를 고르는 실수를 막는다. */
  name: string;
  email: string | null;
  phone?: string | null;
  createdAt?: unknown;
  action: DriverAction;
}

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

/** 결과 알림에 쓰는 동작 이름. ⋮ 메뉴 "정지 풀기…"와 확인창이 같은 말을 쓴다. */
export const DRIVER_ACTION_LABEL: Record<DriverAction, string> = {
  approve: '승인',
  suspend: '정지',
  unsuspend: '정지 풀기',
};

/**
 * 확인창 내용(design-direction.md §5 어드민 "위험 동작 확인창"): 제목 = 동작 + 대상, 한 줄 결과, 대상 정보(이메일·연락처·신청일).
 * 배송 가능 지역은 데이터가 없어 쓰지 않는다. 이름이 비면 자리표시자.
 */
export function describeDriverConfirm(
  pending: Pick<PendingAction, 'name' | 'email' | 'phone' | 'createdAt' | 'action'>,
): {
  title: string;
  lead: string;
  facts: { label: string; value: string }[];
  confirmLabel: string;
} {
  // 타입은 string이지만 옛 문서에 필드가 없을 수 있어 ?.로 방어한다.
  const name = pending.name?.trim() || '이름 없음';
  const facts: { label: string; value: string }[] = [];
  const email = pending.email?.trim();
  if (email) facts.push({ label: '이메일', value: email });
  const phone = pending.phone?.trim();
  if (phone) facts.push({ label: '연락처', value: phone });
  const date = formatAdminDate(pending.createdAt);
  if (date) facts.push({ label: pending.action === 'approve' ? '신청일' : '가입일', value: date });
  if (pending.action === 'approve') {
    return {
      title: `${name} 님을 기사로 승인`,
      lead: '승인하면 기사 앱에서 배송 목록을 받고, 배송 중인 주문의 받는 분 전화번호를 볼 수 있습니다.',
      facts,
      confirmLabel: `${name} 님 승인`,
    };
  }
  if (pending.action === 'suspend') {
    return {
      title: `${name} 님 기사 정지`,
      lead: '정지하면 이 기사는 기사 앱을 쓸 수 없습니다. 배송 중인 주문이 있으면 판매자가 배송 보류로 바꿔야 합니다.',
      facts,
      confirmLabel: `${name} 님 정지`,
    };
  }
  return {
    title: `${name} 님 기사 정지 풀기`,
    lead: '정지를 풀면 이 기사가 다시 기사 앱을 쓸 수 있습니다.',
    facts,
    confirmLabel: `${name} 님 정지 풀기`,
  };
}
