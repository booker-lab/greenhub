import { ORDER_STATUS_LABEL, type Order, type OrderStatus } from '@greenhub/shared';

export type StatusColorKey = { bg: string; text: string };

export interface OrderCardViewModel {
  id: string;
  statusLabel: string;
  actionSignal: string;
  saleTypeLabel: string | null;
  deliveryMethodLabel: string;
  quantityLabel: string;
  totalAmountLabel: string;
  createdAtLabel: string;
  statusColor: StatusColorKey;
  accentColor: string;
}

export interface GroupedOrders {
  normalOrders: Order[];
  groupOrders: Order[];
}

const STATUS_COLORS: Partial<Record<OrderStatus, StatusColorKey>> = {
  PENDING: { bg: 'var(--color-surface-muted)', text: 'var(--color-text-secondary)' },
  RECRUITING: { bg: 'var(--color-status-info-bg)', text: 'var(--color-status-info-text)' },
  CONFIRMED: { bg: 'var(--color-status-info-bg)', text: 'var(--color-status-info-text)' },
  ACCEPTED: { bg: 'var(--color-primary-surface)', text: 'var(--color-primary)' },
  PREPARING: { bg: 'var(--color-primary-surface)', text: 'var(--color-primary)' },
  DELIVERING: { bg: 'var(--color-status-warning-bg)', text: 'var(--color-status-warning-text)' },
  HUB_ARRIVED: { bg: 'var(--color-status-warning-bg)', text: 'var(--color-status-warning-text)' },
  PICKED_UP: { bg: 'var(--color-primary-surface)', text: 'var(--color-primary)' },
  DELIVERED: { bg: 'var(--color-primary-surface)', text: 'var(--color-primary)' },
  CANCELLED: { bg: 'var(--color-danger-surface)', text: 'var(--color-danger)' },
  REVIEWED: { bg: 'var(--color-surface-muted)', text: 'var(--color-text-secondary)' },
};

const ACCENT_COLORS: Partial<Record<OrderStatus, string>> = {
  PENDING: 'var(--color-text-disabled)',
  RECRUITING: 'var(--color-status-info-text)',
  CONFIRMED: 'var(--color-status-info-text)',
  ACCEPTED: 'var(--color-primary)',
  PREPARING: 'var(--color-primary)',
  DELIVERING: 'var(--color-status-warning-text)',
  HUB_ARRIVED: 'var(--color-status-warning-text)',
  PICKED_UP: 'var(--color-primary)',
  DELIVERED: 'var(--color-primary)',
  CANCELLED: 'var(--color-danger)',
  REVIEWED: 'var(--color-text-disabled)',
};

const ACTION_SIGNAL: Partial<Record<OrderStatus, string>> = {
  RECRUITING: '모집 중',
  CONFIRMED: '주문 확정',
  ACCEPTED: '결제 완료',
  PREPARING: '준비 중',
  DELIVERING: '배송 중',
  HUB_ARRIVED: '수령 필요',
  PICKED_UP: '확정 가능',
  DELIVERED: '확정 가능',
  REVIEWED: '확정 완료',
  CANCELLED: '취소됨',
};

export function formatOrderDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export function formatOrderAmount(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

export function getDeliveryMethodLabel(order: Pick<Order, 'deliveryMethod'>): string {
  if (order.deliveryMethod === 'hub') return '거점 픽업';
  if (order.deliveryMethod === 'parcel') return '택배';
  return '직배송';
}

export function groupOrdersBySaleType(orders: Order[]): GroupedOrders {
  return {
    normalOrders: orders.filter((order) => order.saleType !== 'group'),
    groupOrders: orders.filter((order) => order.saleType === 'group'),
  };
}

export function getOrderActionSignal(status: OrderStatus): string {
  return ACTION_SIGNAL[status] ?? ORDER_STATUS_LABEL[status] ?? status;
}

export function toOrderCardViewModel(order: Order): OrderCardViewModel {
  return {
    id: order.id,
    statusLabel: ORDER_STATUS_LABEL[order.status] ?? order.status,
    actionSignal: getOrderActionSignal(order.status),
    saleTypeLabel: order.saleType === 'group' ? '공동구매' : null,
    deliveryMethodLabel: getDeliveryMethodLabel(order),
    quantityLabel: `수량 ${order.quantity}개`,
    totalAmountLabel: formatOrderAmount(order.totalAmount),
    createdAtLabel: formatOrderDate(order.createdAt),
    statusColor: STATUS_COLORS[order.status] ?? {
      bg: 'var(--color-surface-muted)',
      text: 'var(--color-text-secondary)',
    },
    accentColor: ACCENT_COLORS[order.status] ?? 'var(--color-text-disabled)',
  };
}
