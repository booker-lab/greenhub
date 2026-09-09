// 주문 상태 라벨/색 — orders 탭 표현 SSOT(테이블·카드·필터 공용).
export const STATUS_LABEL: Record<string, string> = {
  PENDING: '결제대기',
  RECRUITING: '모집중',
  ACCEPTED: '접수됨',
  CONFIRMED: '확정',
  PREPARING: '준비중',
  DELIVERING: '배달중',
  HUB_ARRIVED: '거점도착',
  PICKED_UP: '픽업완료',
  DELIVERED: '배달완료',
  REVIEWED: '리뷰완료',
  CANCELLED: '취소됨',
};

export function getStatusColor(status: string): string {
  if (status === 'CANCELLED') return 'red';
  if (status === 'DELIVERED' || status === 'REVIEWED') return 'green';
  return 'yellow';
}

// 강제환불 가능 상태 — 배달 진행 전까지만 허용.
export const REFUNDABLE = ['ACCEPTED', 'RECRUITING', 'CONFIRMED', 'PREPARING'];

// Admin 주문 목록 read state — 조회 실패와 성공-empty의 구조적 구분.
// useAdminOrders는 error/reload를 노출하지만 화면이 이를 소비하지 않으면
// 조회 실패가 빈 목록("주문이 없습니다.")으로 collapse된다.
// 분기 우선순위(loading > error > empty > results)를 순수 함수로 고정한다.
export type AdminOrdersReadState = 'LOADING' | 'FETCH_ERROR' | 'EMPTY' | 'HAS_RESULTS';

export function getAdminOrdersReadState(args: {
  loading: boolean;
  error: string | null;
  orders: readonly unknown[];
}): AdminOrdersReadState {
  if (args.loading) return 'LOADING';
  if (args.error !== null) return 'FETCH_ERROR';
  if (args.orders.length === 0) return 'EMPTY';
  return 'HAS_RESULTS';
}

// 상태 필터 Select 옵션 — '전체' + 전 상태.
export function buildStatusOptions(): { value: string; label: string }[] {
  return [
    { value: '', label: '전체 상태' },
    ...Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: k, label: v })),
  ];
}
