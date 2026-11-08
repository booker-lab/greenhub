// 수거 대기 탭 묶음. API가 주는 assignedToMe(요청한 기사 본인 배정 여부)로
// "내 수거"와 "맡을 수 있는 주문"을 나눈다. 배정 여부를 모르는 주문이 하나라도 있으면(이전 API 응답)
// 맡을 수 있다고 잘못 보이지 않도록 나누지 않고 null을 돌려준다(화면은 예전처럼 한 묶음으로 보인다).

export type PreparingGroups<T> = { mine: T[]; available: T[] };

export function groupPreparingOrders<T extends { assignedToMe?: unknown }>(
  orders: readonly T[],
): PreparingGroups<T> | null {
  if (orders.length === 0) return null;
  if (!orders.every((order) => typeof order.assignedToMe === 'boolean')) return null;
  return {
    mine: orders.filter((order) => order.assignedToMe === true),
    available: orders.filter((order) => order.assignedToMe === false),
  };
}
