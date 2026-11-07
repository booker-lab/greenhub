import type { Order } from '@greenhub/shared';
import { STATUS_GROUP_MAP } from '../app/orders/_constants';

/**
 * 주문 목록 최신성 순수 계약.
 * 화면을 열어 둔 동안 일정 간격으로 다시 읽고, 다시 읽은 결과에서 새로 생긴 처리 필요 주문을 찾는다.
 * vitest에서 `@/` alias 없이 직접 검증할 수 있도록 Framework 의존성을 두지 않는다.
 */

/** 주문 화면을 열어 둔 동안 진행 중 주문을 다시 읽는 간격. */
export const SELLER_ORDERS_POLL_INTERVAL_MS = 60_000;

/**
 * 간격 재조회를 지금 부를지 판정한다.
 * - 숨은 탭이면 부르지 않는다(화면 복귀 때 visibilitychange 재조회가 따로 돈다).
 * - 이미 읽는 중이면 겹쳐 부르지 않는다.
 */
export function shouldPollSellerOrders(state: { hidden: boolean; inFlight: boolean }): boolean {
  return !state.hidden && !state.inFlight;
}

/** 처리 필요 묶음(ACTION_REQUIRED)에 속한 주문 id 모음. */
export function collectActionRequiredOrderIds(
  orders: readonly Pick<Order, 'id' | 'status'>[],
): Set<string> {
  const ids = new Set<string>();
  for (const order of orders) {
    if (STATUS_GROUP_MAP[order.status] === 'ACTION_REQUIRED') ids.add(order.id);
  }
  return ids;
}

/**
 * 이전에 없던 처리 필요 주문 수.
 * 이전 기준이 없으면(첫 조회·범위 전환 직후) 0이다 — 처음 받은 목록 전체를 새 주문으로 알리지 않는다.
 */
export function countNewActionRequiredOrders(
  previousIds: ReadonlySet<string> | null,
  nextIds: ReadonlySet<string>,
): number {
  if (previousIds === null) return 0;
  let count = 0;
  for (const id of nextIds) {
    if (!previousIds.has(id)) count += 1;
  }
  return count;
}
