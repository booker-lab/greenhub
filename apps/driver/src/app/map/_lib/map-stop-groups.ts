import { splitDeliveryAddress } from '../../../lib/address-parts';
import { groupPreparingOrders } from '../../../lib/preparing-groups';

/**
 * 기사 지도 탭 목록 묶음. 주문에 배송지 좌표가 없어 목록 순서는 경로 순서가 아니므로
 * 번호 대신 상태로 묶는다(배송 중 → 수거 대기). 묶음 안 순서는 들어온 순서 그대로다.
 * 수거 대기는 작업 보드처럼 assignedToMe로 "내 수거"와 "맡을 수 있는 주문"을 나눈다.
 * 배정 여부를 모르는 주문이 하나라도 있으면(이전 API 응답) 나누지 않고 한 묶음이다.
 * 보류(DELIVERY_HELD) 주문은 지도 목록에 올리지 않고 수만 센다.
 */

export type MapStopStatus = 'DELIVERING' | 'PREPARING';

export type MapStopGroup<T> = { status: MapStopStatus; label: string; orders: T[] };

/** 지도 목록에 올리는 주문(배송 중·수거 대기)인지. */
export function isMapStop(order: { status?: string }): boolean {
  return order.status === 'DELIVERING' || order.status === 'PREPARING';
}

/** 배송 중 → 수거 대기(내 수거 → 맡을 수 있는 주문) 순서로, 주문이 있는 묶음만 돌려준다. */
export function groupMapStops<T extends { status?: string; assignedToMe?: unknown }>(
  route: readonly T[],
): MapStopGroup<T>[] {
  const delivering = route.filter((order) => order.status === 'DELIVERING');
  const preparing = route.filter((order) => order.status === 'PREPARING');
  const split = groupPreparingOrders(preparing);
  const groups: MapStopGroup<T>[] = [
    { status: 'DELIVERING', label: '배송 중', orders: delivering },
    ...(split
      ? [
          { status: 'PREPARING' as const, label: '내 수거', orders: split.mine },
          { status: 'PREPARING' as const, label: '맡을 수 있는 주문', orders: split.available },
        ]
      : [{ status: 'PREPARING' as const, label: '수거 대기', orders: preparing }]),
  ];
  return groups.filter((group) => group.orders.length > 0);
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
