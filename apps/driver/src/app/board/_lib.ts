export type DriverBoardTab = 'preparing' | 'delivering';

export type DriverBoardOrder = {
  id: string;
  status: string;
  deliveryMethod: string;
  buyerName?: string;
  address?: string;
  hubName?: string;
  hubAddress?: string;
  productName?: string;
  quantity?: number;
  preparedAt?: { seconds: number } | null;
  deliveredAt?: { seconds: number } | null;
  updatedAt?: { seconds: number } | null;
};

export const BOARD_TABS: ReadonlyArray<{
  key: DriverBoardTab;
  label: string;
  badgeColor: string;
}> = [
  { key: 'preparing', label: '수거 대기', badgeColor: 'red' },
  { key: 'delivering', label: '배송 중', badgeColor: 'blue' },
];

export const METHOD_BADGE: Record<string, { label: string; color: string }> = {
  direct: { label: '직배송', color: 'green' },
  hub: { label: '거점 픽업', color: 'blue' },
  parcel: { label: '택배', color: 'gray' },
};

export function parseBoardTab(tab: string | null): DriverBoardTab {
  return tab === 'delivering' ? 'delivering' : 'preparing';
}

export function formatBoardTime(ts?: { seconds: number } | null): string {
  if (!ts) return '시간 미정';
  return new Date(ts.seconds * 1000).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getBoardOrderLocation(order: DriverBoardOrder): string {
  if (order.deliveryMethod === 'hub') {
    const address = order.hubAddress ?? '-';
    return `${order.hubName ?? '거점'} · ${address}`;
  }

  return order.address ?? '-';
}

export function getBoardOrderTimeLabel(order: DriverBoardOrder, tab: DriverBoardTab): string {
  return tab === 'preparing'
    ? `수거 ${formatBoardTime(order.preparedAt)}`
    : `배송 시작 ${formatBoardTime(order.updatedAt)}`;
}

export function getBoardEmptyMessage(tab: DriverBoardTab): string {
  return tab === 'preparing' ? '오늘 수거할 주문이 없습니다' : '현재 배송 중인 주문이 없습니다';
}
