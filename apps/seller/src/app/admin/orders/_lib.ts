import type { OrderStatus } from '@greenhub/shared';

// 주문 상태 라벨/색 — orders 탭 표현 SSOT(테이블·카드·필터 공용).
// Record<OrderStatus>라 공유 상태가 늘면 라벨 누락을 컴파일 단계에서 잡는다.
export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: '결제대기',
  RECRUITING: '모집중',
  ACCEPTED: '접수됨',
  CONFIRMED: '확정',
  PREPARING: '준비중',
  DELIVERING: '배달중',
  DELIVERY_HELD: '배송 보류',
  HUB_ARRIVED: '거점도착',
  PICKED_UP: '픽업완료',
  DELIVERED: '배달완료',
  REVIEWED: '리뷰완료',
  CANCELLED: '취소됨',
};

export function getStatusColor(status: OrderStatus): string {
  if (status === 'CANCELLED' || status === 'DELIVERY_HELD') return 'red';
  if (status === 'DELIVERED' || status === 'REVIEWED') return 'green';
  return 'yellow';
}

// 강제환불 버튼 노출 — 서버(admin.service forceRefund)가 허용하는 상태와 같게 유지한다.
// 회차 주문(schemaVersion 2 + roundId): round-order-lifecycle.service claimCancellation 허용 상태.
const ROUND_REFUNDABLE: readonly string[] = [
  'PENDING',
  'ACCEPTED',
  'RECRUITING',
  'CONFIRMED',
  'PREPARING',
  'DELIVERY_HELD',
];
// 일반 주문: orders.helpers getAllowedTransitions('admin')가 CANCELLED를 허용하는 상태.
const LEGACY_REFUNDABLE: readonly string[] = ['ACCEPTED', 'CONFIRMED', 'PREPARING'];

export function isRoundOrder(order: { schemaVersion?: number; roundId?: string | null }): boolean {
  return order.schemaVersion === 2 && !!order.roundId;
}

export function isRefundable(order: {
  status: string;
  schemaVersion?: number;
  roundId?: string | null;
}): boolean {
  const allowed = isRoundOrder(order) ? ROUND_REFUNDABLE : LEGACY_REFUNDABLE;
  return allowed.includes(order.status);
}

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
