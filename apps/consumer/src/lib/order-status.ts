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
  // 고객 사유 종결(환불 없음). 취소(환불)와 구분한다.
  CLOSED_UNDELIVERED: '배송 종결',
};

// 주문 상세 "배송 현황" 단계 이름. 단계는 진행 순서를 보여 주므로 첫 단계는 상태 이름('결제 완료')이 아니라
// 단계 이름('주문 접수')으로 부른다. 결제 확인 중(PENDING) 주문도 첫 단계를 진행 중으로 그리는데,
// 상태 이름을 그대로 쓰면 머리는 '결제 확인 중', 단계는 '결제 완료'로 서로 어긋나 보인다.
const ORDER_TIMELINE_STEP_LABELS: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: '주문 접수',
};

export function orderTimelineStepLabel(status: OrderStatus): string {
  return ORDER_TIMELINE_STEP_LABELS[status] ?? ORDER_STATUS_LABELS[status] ?? status;
}
