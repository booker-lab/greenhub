export type DriverOrderDetail = {
  id?: string;
  storeId: string;
  status: string;
  deliveryMethod: string;
  buyerName?: string;
  address?: string;
  deliveryAddress?: { address?: string };
  hubName?: string;
  hubAddress?: string;
  productName?: string;
  quantity?: number;
  preparedAt?: { seconds: number } | null;
  sellerPhone?: string;
  buyerPhone?: string;
};

export const DETAIL_METHOD_LABEL: Record<string, string> = {
  direct: '직배송',
  hub: '거점 픽업',
  parcel: '택배',
};

export type DetailContact = {
  label: string;
  phone: string;
};

export type DetailCta =
  | { kind: 'start-delivery'; status: 'DELIVERING'; label: string; color: 'brand' }
  | { kind: 'complete-direct'; status: 'DELIVERED'; label: string; color: 'brand' }
  | { kind: 'hub-photo'; label: string; color: 'blue' }
  | { kind: 'none' };

export function isDetailDelivering(order: DriverOrderDetail): boolean {
  return order.status === 'DELIVERING';
}

export function isDetailPreparing(order: DriverOrderDetail): boolean {
  return order.status === 'PREPARING';
}

export function isHubOrder(order: DriverOrderDetail): boolean {
  return order.deliveryMethod === 'hub';
}

export function formatPreparedTime(ts?: { seconds: number } | null): string {
  if (!ts) return '시간 미정';
  return new Date(ts.seconds * 1000).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getProductSummary(order: DriverOrderDetail): string {
  return `${order.productName ?? '-'}${order.quantity ? ` × ${order.quantity}` : ''}`;
}

export function getDeliveryAddress(order: DriverOrderDetail): string {
  return order.address ?? order.deliveryAddress?.address ?? '-';
}

export function getVisibleContacts(order: DriverOrderDetail): DetailContact[] {
  if (isDetailPreparing(order) && order.sellerPhone) {
    return [{ label: '판매자', phone: order.sellerPhone }];
  }

  if (isDetailDelivering(order) && isHubOrder(order) && order.sellerPhone) {
    return [{ label: '판매자', phone: order.sellerPhone }];
  }

  if (isDetailDelivering(order) && !isHubOrder(order) && order.buyerPhone) {
    return [{ label: '소비자', phone: order.buyerPhone }];
  }

  return [];
}

export function getDetailCta(order: DriverOrderDetail): DetailCta {
  if (isDetailPreparing(order)) {
    return {
      kind: 'start-delivery',
      status: 'DELIVERING',
      label: '수거 완료 / 배송 시작',
      color: 'brand',
    };
  }

  if (isDetailDelivering(order) && !isHubOrder(order)) {
    return {
      kind: 'complete-direct',
      status: 'DELIVERED',
      label: '배송 완료',
      color: 'brand',
    };
  }

  if (isDetailDelivering(order) && isHubOrder(order)) {
    return {
      kind: 'hub-photo',
      label: '거점 도착',
      color: 'blue',
    };
  }

  return { kind: 'none' };
}

export function getDeliveryPhotoPath(orderId: string, timestamp = Date.now()): string {
  return `deliveryPhotos/${orderId}_${timestamp}.jpg`;
}

export function buildHubArrivedPayload(photoUrl: string): string {
  return JSON.stringify({ status: 'HUB_ARRIVED', photoUrl });
}
