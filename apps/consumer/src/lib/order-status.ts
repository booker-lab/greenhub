import type { OrderStatus } from '@greenhub/shared';

// 고객 화면의 주문 상태 이름표. MY 주문 목록과 주문 상세(머리·배송 현황)가 이 표 하나를 같이 써서
// 같은 주문이 화면마다 다른 이름으로 보이지 않게 한다. 결제가 끝나 접수된 주문(ACCEPTED)은
// 알림 화면(ORDER_ACCEPTED)과 같이 '결제 완료'라고 부른다.
export const ORDER_STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING: '결제 확인 중',
  RECRUITING: '모집 중',
  CONFIRMED: '주문 확정',
  ACCEPTED: '결제 완료',
  PREPARING: '상품 준비 중',
  DELIVERING: '배송 중',
  DELIVERY_HELD: '배송 보류',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '주문 취소',
  REVIEWED: '구매 확정',
};
