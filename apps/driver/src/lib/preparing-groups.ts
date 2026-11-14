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

export type PreparingFirstScreen<T> = { mine: T[]; available: T[]; hidden: number };

/**
 * 두 묶음을 합쳐 첫 화면 행 수(limit)만 남긴다. 내 수거가 먼저 채워지고 남는 자리를 맡을 수 있는 주문이 쓴다.
 * hidden은 가려진 행 수의 합이라 "남은 n곳 더 보기"가 정확한 수를 보인다.
 */
export function takePreparingFirstScreen<T>(
  groups: PreparingGroups<T>,
  limit: number,
): PreparingFirstScreen<T> {
  const mine = groups.mine.slice(0, limit);
  const available = groups.available.slice(0, Math.max(0, limit - mine.length));
  return {
    mine,
    available,
    hidden: groups.mine.length + groups.available.length - mine.length - available.length,
  };
}
