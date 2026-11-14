// 배송 중 탭 묶음. 보류(DELIVERY_HELD) 주문은 "보류" 묶음으로 따로 보이고, 나머지는 "배송할 주문"이다.
// 배송할 주문 안 순서는 목록 응답 순서 그대로다(경로 순서는 만들지 않는다).
// 보류 묶음은 첫 화면 행 수를 배송할 주문과 따로 세어, 보류가 배송할 주문을 첫 화면 밖으로 밀어내지 않게 한다.

export type DeliveringGroups<T> = {
  /** 보류가 아닌 첫 DELIVERING 주문. "다음 배송지" 카드로 크게 보인다. */
  next: T | undefined;
  /** 다음 배송지를 뺀 배송할 주문. */
  rest: T[];
  held: T[];
};

export function groupDeliveringOrders<T extends { status?: string }>(
  orders: readonly T[],
): DeliveringGroups<T> {
  const active = orders.filter((order) => order.status !== 'DELIVERY_HELD');
  const next = active.find((order) => order.status === 'DELIVERING');
  return {
    next,
    rest: next ? active.filter((order) => order !== next) : active,
    held: orders.filter((order) => order.status === 'DELIVERY_HELD'),
  };
}

export type DeliveringFirstScreen<T> = { next: T | undefined; rest: T[]; held: T[]; hidden: number };

/** 배송할 주문(다음 배송지 제외)과 보류 묶음이 각각 limit행까지 보이고, hidden은 가려진 행 수의 합이다. */
export function takeDeliveringFirstScreen<T>(
  groups: DeliveringGroups<T>,
  limit: number,
): DeliveringFirstScreen<T> {
  const rest = groups.rest.slice(0, limit);
  const held = groups.held.slice(0, limit);
  return {
    next: groups.next,
    rest,
    held,
    hidden: groups.rest.length - rest.length + groups.held.length - held.length,
  };
}
