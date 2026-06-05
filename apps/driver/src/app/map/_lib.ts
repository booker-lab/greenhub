export type DriverMapOrder = {
  id: string;
  status: string;
  deliveryMethod: string;
  buyerName?: string;
  address?: string;
  hubName?: string;
  hubAddress?: string;
  lat?: number;
  lng?: number;
};

export type MapPoint = {
  lat: number;
  lng: number;
};

export type MappableDriverMapOrder = DriverMapOrder & MapPoint;

export function hasMapPoint(order: DriverMapOrder): order is MappableDriverMapOrder {
  return Number.isFinite(order.lat) && Number.isFinite(order.lng);
}

export function getMappableOrders(orders: DriverMapOrder[]): MappableDriverMapOrder[] {
  return orders.filter(hasMapPoint);
}

export function getMapCenter(orders: MappableDriverMapOrder[]): MapPoint {
  if (orders.length === 0) return { lat: 37.5665, lng: 126.978 };
  return { lat: orders[0].lat, lng: orders[0].lng };
}

export function nearestNeighbor(orders: DriverMapOrder[]): DriverMapOrder[] {
  if (orders.length <= 1) return orders;
  const visited = new Set<string>();
  const result: DriverMapOrder[] = [];
  let current = orders[0];
  result.push(current);
  visited.add(current.id);

  while (result.length < orders.length) {
    let nearest: DriverMapOrder | null = null;
    let minDist = Infinity;

    for (const order of orders) {
      if (visited.has(order.id)) continue;
      if (!hasMapPoint(order) || !hasMapPoint(current)) {
        nearest = order;
        break;
      }

      const dist = Math.hypot(order.lat - current.lat, order.lng - current.lng);
      if (dist < minDist) {
        minDist = dist;
        nearest = order;
      }
    }

    if (!nearest) break;
    result.push(nearest);
    visited.add(nearest.id);
    current = nearest;
  }

  return result;
}

export function getMapOrderAddress(order: DriverMapOrder): string {
  if (order.deliveryMethod === 'hub') {
    return `${order.hubName ?? '거점'} · ${order.hubAddress ?? '-'}`;
  }

  return order.address ?? '-';
}

export function getMapOrderDestinationName(order: DriverMapOrder): string {
  return order.deliveryMethod === 'hub' ? (order.hubAddress ?? '') : (order.address ?? '');
}

export function getMapStatusBadge(status: string): { label: string; color: string } {
  return status === 'DELIVERING'
    ? { label: '배송 중', color: 'blue' }
    : { label: '수거 대기', color: 'yellow' };
}

export function buildKakaoNaviUrl(sorted: DriverMapOrder[]): string {
  if (sorted.length === 0) return '';

  const last = sorted[sorted.length - 1];
  const destination = getMapOrderDestinationName(last);
  const via = sorted
    .slice(0, -1)
    .map((order, index) =>
      order.lat ? `via${index}Lat=${order.lat}&via${index}Lng=${order.lng}` : '',
    )
    .filter(Boolean)
    .join('&');

  return (
    `kakaomap://route?ep=${last.lat ?? 0},${last.lng ?? 0}` +
    `&eName=${encodeURIComponent(destination)}` +
    (via ? `&${via}` : '')
  );
}
