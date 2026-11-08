import { splitDeliveryAddress } from '../../../lib/address-parts';

/**
 * 기사 지도 탭 목록 묶음. 주문에 배송지 좌표가 없어 목록 순서는 경로 순서가 아니므로
 * 번호 대신 상태로 묶는다(배송 중 → 수거 대기). 묶음 안 순서는 들어온 순서 그대로다.
 * 보류(DELIVERY_HELD) 주문은 지도 목록에 올리지 않고 수만 센다.
 */

export type MapStopStatus = 'DELIVERING' | 'PREPARING';

export type MapStopGroup<T> = { status: MapStopStatus; label: string; orders: T[] };

const GROUP_ORDER: ReadonlyArray<{ status: MapStopStatus; label: string }> = [
  { status: 'DELIVERING', label: '배송 중' },
  { status: 'PREPARING', label: '수거 대기' },
];

/** 지도 목록에 올리는 주문(배송 중·수거 대기)인지. */
export function isMapStop(order: { status?: string }): boolean {
  return order.status === 'DELIVERING' || order.status === 'PREPARING';
}

/** 배송 중 → 수거 대기 순서로, 주문이 있는 묶음만 돌려준다. */
export function groupMapStops<T extends { status?: string }>(
  route: readonly T[],
): MapStopGroup<T>[] {
  return GROUP_ORDER.map(({ status, label }) => ({
    status,
    label,
    orders: route.filter((order) => order.status === status),
  })).filter((group) => group.orders.length > 0);
}

/** 지도 목록에서 빠지는 보류 주문 수. */
export function countHeldOrders(orders: readonly { status?: string }[]): number {
  return orders.filter((order) => order.status === 'DELIVERY_HELD').length;
}

export type MapStopAddressOrder = {
  deliveryMethod?: string;
  address?: string;
  deliveryAddress?: { address?: string } | null;
  hubName?: string;
  hubAddress?: string;
};

/**
 * 행 주소 한 줄. 직배송은 동·호수(상세 주소)를 앞에 쓰고 기본 주소를 뒤에 쓴다(작업 보드 행과 같은 규칙).
 * 거점은 거점 이름을 앞에, 거점 주소를 뒤에 쓴다.
 */
export function mapStopAddressLine(order: MapStopAddressOrder): string {
  if (order.deliveryMethod === 'hub') {
    return `${order.hubName ?? '거점'} · ${order.hubAddress ?? '-'}`;
  }
  const parts = splitDeliveryAddress(order.address, order.deliveryAddress?.address);
  if (!parts) return '-';
  return parts.detail ? `${parts.detail} · ${parts.base}` : parts.base;
}
