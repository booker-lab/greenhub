// 배송 중 탭 묶음. 보류(DELIVERY_HELD) 주문은 "보류" 묶음으로 따로 보이고, 나머지는 "배송할 주문"이다.
// 완료 사진이 이 기기 대기열에 있는 배송 중 주문은 문 앞에서 이미 사진을 찍은 주문이므로
// "다음 배송지" 후보에서 빼고 "사진 올리는 중" 묶음으로 따로 보인다(3차 재감사 S-02).
// 다만 멈춘(failed) 사진은 다시 보내지 않으므로(사진 바이트 삭제) 이 묶음에 넣지 않는다. 그 주문은
// "사진 등록 실패" 배지를 단 채 배송할 주문에 남고 다음 배송지가 될 수 있다(재배송을 건너뛰지 않게).
// 배송할 주문 안 순서는 목록 응답 순서 그대로다(경로 순서는 만들지 않는다).
// 보류·사진 올리는 중 묶음은 첫 화면 행 수를 배송할 주문과 따로 세어, 배송할 주문을 첫 화면 밖으로 밀어내지 않게 한다.

export type DeliveringGroups<T> = {
  /** 보류도 사진 대기도 아닌 첫 DELIVERING 주문. "다음 배송지" 카드로 크게 보인다. */
  next: T | undefined;
  /** 다음 배송지를 뺀 배송할 주문. */
  rest: T[];
  /** 완료 사진이 대기열에 있는 배송 중 주문("사진 올리는 중"). */
  photoPending: T[];
  held: T[];
};

const NO_PENDING: ReadonlySet<string> = new Set();

/**
 * 앱이 아직 올릴 사진(보내는 중·대기)이 있는 주문 ID. 멈춘(state 'failed') 항목은 뺀다.
 * 멈춘 항목은 다시 보내지 않으므로 "사진 올리는 중"·다음 배송지 제외의 근거가 되지 못한다
 * (예: 보류 뒤 STALE_HOLD로 멈춘 사진이 남은 채 다시 배송 중이 된 주문).
 * 작업 보드와 지도 탭이 같은 규칙을 쓰도록 이 함수로만 만든다. 한 번에 수거 제외는 멈춤 항목도 포함해 따로 센다.
 */
export function inFlightPhotoOrderIds(
  entries: readonly { orderId: string; state: string }[],
): ReadonlySet<string> {
  return new Set(entries.filter((entry) => entry.state !== 'failed').map((entry) => entry.orderId));
}

/**
 * pendingPhotoOrderIds는 앱이 아직 올릴 완료 사진이 있는 주문 ID다(inFlightPhotoOrderIds, 멈춤 제외).
 * 화면 훅(usePendingPhotos)을 이 함수 밖에서 읽어 넘겨 순수 함수로 둔다.
 */
export function groupDeliveringOrders<T extends { id?: string; status?: string }>(
  orders: readonly T[],
  pendingPhotoOrderIds: ReadonlySet<string> = NO_PENDING,
): DeliveringGroups<T> {
  const isPhotoPending = (order: T) =>
    order.status === 'DELIVERING' &&
    typeof order.id === 'string' &&
    pendingPhotoOrderIds.has(order.id);
  const active = orders.filter(
    (order) => order.status !== 'DELIVERY_HELD' && !isPhotoPending(order),
  );
  const next = active.find((order) => order.status === 'DELIVERING');
  return {
    next,
    rest: next ? active.filter((order) => order !== next) : active,
    photoPending: orders.filter(isPhotoPending),
    held: orders.filter((order) => order.status === 'DELIVERY_HELD'),
  };
}

export type DeliveryProgressCounts = {
  /** 아직 들러야 하는 배송 중 주문(다음 배송지 + 배송할 주문). 지도 탭 "배송 중"과 같은 수다. */
  toDeliver: number;
  /** 사진을 찍어 앱이 올리고 있는 주문. 이미 들른 곳이라 남은 배송에 세지 않는다. */
  photoPending: number;
  held: number;
};

/** 작업 보드 진행 줄 숫자. 묶음과 같은 규칙(groupDeliveringOrders)으로 센다. */
export function countDeliveryProgress<T extends { id?: string; status?: string }>(
  orders: readonly T[],
  pendingPhotoOrderIds: ReadonlySet<string> = NO_PENDING,
): DeliveryProgressCounts {
  const groups = groupDeliveringOrders(orders, pendingPhotoOrderIds);
  return {
    toDeliver: groups.rest.length + (groups.next ? 1 : 0),
    photoPending: groups.photoPending.length,
    held: groups.held.length,
  };
}

export type DeliveringFirstScreen<T> = {
  next: T | undefined;
  rest: T[];
  photoPending: T[];
  held: T[];
  hidden: number;
};

/**
 * 배송할 주문(다음 배송지 제외)·사진 올리는 중·보류 묶음이 각각 limit행까지 보이고,
 * hidden은 가려진 행 수의 합이다.
 */
export function takeDeliveringFirstScreen<T>(
  groups: DeliveringGroups<T>,
  limit: number,
): DeliveringFirstScreen<T> {
  const rest = groups.rest.slice(0, limit);
  const photoPending = groups.photoPending.slice(0, limit);
  const held = groups.held.slice(0, limit);
  return {
    next: groups.next,
    rest,
    photoPending,
    held,
    hidden:
      groups.rest.length -
      rest.length +
      groups.photoPending.length -
      photoPending.length +
      groups.held.length -
      held.length,
  };
}
