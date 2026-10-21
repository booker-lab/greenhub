// 상태 전이 고객 알림의 멱등 키와 반복 상한. 같은 전이 알림은 결정적인 키로 한 번만 보내고,
// 배송 보류·재개를 반복해도 보류 회차 상한까지만 알림톡을 보낸다(상태 전이 자체는 막지 않는다).
import type { OrderStatus } from './dto/update-status.dto';

type OrderRecord = Record<string, unknown>;

/**
 * 보류·재배송·재개 알림을 보내는 배송 보류 회차의 상한. 보류 회차 번호가 이 값을 넘으면 그 회차의
 * 보류·재배송 결제 요청·재배송 예정·재개 배송 시작 알림을 보내지 않는다. 정상 운영의 보류는 한두 번이고
 * 유료 재배송도 1회만 열리므로(재배송 실패는 운영 이슈로 넘어간다) 3회면 여유가 있다.
 * 배송 완료·취소·거점 도착 알림은 보류 회차와 무관하게 주문당 한 번 보낸다.
 */
export const MAX_NOTIFIED_DELIVERY_HOLDS = 3;

/**
 * 주문이 지금까지 배송 보류된 횟수(보류 회차 번호). 보류에 들어갈 때마다 1씩 늘려 저장한다.
 * 이 필드가 생기기 전 주문은 보류 기록(deliveryHold)이 있으면 1, 없으면 0으로 본다.
 */
export function readDeliveryHoldCount(order: OrderRecord): number {
  const raw = order['deliveryHoldCount'];
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) return raw;
  return order['deliveryHold'] ? 1 : 0;
}

/**
 * 배송 보류 회차에 묶인 전이인지. 보류 진입, 보류에서 재배송 준비·배송 재개, 준비 중에서 배송 시작
 * (보류 뒤 재개일 수 있다)이 해당한다. 취소는 종료 상태라 회차와 무관하다.
 */
export function isDeliveryHoldCycleTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (to === 'CANCELLED') return false;
  return (
    to === 'DELIVERY_HELD' ||
    from === 'DELIVERY_HELD' ||
    (from === 'PREPARING' && to === 'DELIVERING')
  );
}

/**
 * 전이 직후의 보류 회차 번호. 보류 진입은 새 회차(이전 횟수 + 1)이고, 그 밖의 전이는 진행 중이거나
 * 마지막으로 끝난 회차 번호다. 전이 전 주문 문서로 계산한다.
 */
export function transitionHoldCycle(order: OrderRecord, to: OrderStatus): number {
  const count = readDeliveryHoldCount(order);
  return to === 'DELIVERY_HELD' ? count + 1 : count;
}

/** 보류 회차 상한을 넘어 이 전이 알림을 보내지 않아야 하는지. */
export function exceedsDeliveryHoldNoticeLimit(
  from: OrderStatus,
  to: OrderStatus,
  holdCycle: number,
): boolean {
  return isDeliveryHoldCycleTransition(from, to) && holdCycle > MAX_NOTIFIED_DELIVERY_HOLDS;
}

/**
 * 상태 전이 고객 알림의 멱등 키. 같은 주문의 같은 전이(같은 보류 회차)는 같은 키가 되어 한 번만 나간다.
 * - 취소는 종료 상태라 어느 상태에서 왔든 주문당 한 번이다.
 * - 보류 회차에 묶인 전이는 회차 번호를 붙여 회차마다 한 번씩 보낸다. 보류가 없던 첫 배송 시작은
 *   회차 번호 없이 `order-transition:{orderId}:PREPARING:DELIVERING`이다.
 * - 그 밖의 전이는 `order-transition:{orderId}:{from}:{to}`이다. 배송 완료 재조정
 *   (reconcileDeliveryCompletion)이 쓰던 `order-transition:{orderId}:DELIVERING:DELIVERED`와 같다.
 */
export function orderTransitionNoticeKey(
  orderId: string,
  from: OrderStatus,
  to: OrderStatus,
  holdCycle: number,
): string {
  if (to === 'CANCELLED') return `order-transition:${orderId}:CANCELLED`;
  const base = `order-transition:${orderId}:${from}:${to}`;
  return isDeliveryHoldCycleTransition(from, to) && holdCycle > 0
    ? `${base}:hold-${holdCycle}`
    : base;
}

/**
 * 공동구매 전체 참여자 알림의 멱등 범위. 참여 주문마다 `{범위}:{참여 주문 ID}` 키가 되어, 여러 참여
 * 주문이 같은 단계로 바뀌어도 참여자는 그 단계 알림을 한 번만 받는다.
 */
export function groupTransitionNoticeScope(productId: string, templateCode: string): string {
  return `order-transition-group:${productId}:${templateCode}`;
}
