import { type Order, type OrderStatus, toDateStrKST, todayKST } from '@greenhub/shared';

export function toDate(v: unknown): Date {
  if (v && typeof v === 'object' && 'toDate' in v) return (v as { toDate(): Date }).toDate();
  return new Date(v as string);
}

export function formatDeadlineCountdown(deadline: string): string {
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return '마감됨';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `마감까지 ${days}일`;
  return `마감까지 ${hours}시간`;
}

export function makePreparedAtOptions(): { label: string; iso: string }[] {
  const today = todayKST();
  const tomorrow = toDateStrKST(new Date(Date.now() + 86400000));
  return [
    { label: '오늘 오후 2시', iso: `${today}T05:00:00.000Z` },
    { label: '오늘 오후 4시', iso: `${today}T07:00:00.000Z` },
    { label: '내일 오전 9시', iso: `${tomorrow}T00:00:00.000Z` },
  ];
}

export const READONLY_STATUSES: OrderStatus[] = [
  'DELIVERING',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'REVIEWED',
  'CANCELLED',
];

export const CANCELLABLE_STATUSES: OrderStatus[] = ['ACCEPTED', 'CONFIRMED', 'PREPARING'];

// buyerName은 주문한 계정 이름이다(선물 받는 분은 요청사항에 적는다).
// 셀러 상세 API는 연락처를 주문서의 deliveryPhone 하나로 내려준다(없으면 buyerPhone 대체).
export function displayBuyerName(order: Pick<Order, 'buyerName'>): string {
  return order.buyerName?.trim() || '이름 없음';
}

export function displayBuyerPhone(order: Pick<Order, 'deliveryPhone'>): string | null {
  return order.deliveryPhone?.trim() || null;
}

// 소비자 요청사항(받는 분·선물 문구·배송 요청). 없거나 공백뿐이면 영역을 그리지 않는다.
export function displayRequestNote(order: Pick<Order, 'requestNote'>): string | null {
  return order.requestNote?.trim() || null;
}

export interface OrderItemLine {
  key: string;
  productName: string;
  quantity: number;
  subtotalAmount: number | null;
}

function itemProductName(item: { productName?: unknown } | null | undefined): string | null {
  return typeof item?.productName === 'string' && item.productName.trim()
    ? item.productName.trim()
    : null;
}

/**
 * 포장할 상품 줄(상품명 × 수량). 회차 주문이나 상품이 여러 개인 주문만 줄로 보여 준다.
 * 예전 단일 상품 주문은 null → 기존 "상품명·수량" 줄을 그대로 쓴다
 * (상세 API는 예전 주문에도 상품 줄 하나를 만들어 주므로 줄 존재만으로 고르지 않는다).
 * 한 줄도 숨기지 않도록 이름이 비면 대체 문구로 보여 준다.
 */
export function resolveOrderItemLines(
  order: Pick<Order, 'roundId' | 'orderItems'>,
): OrderItemLine[] | null {
  const items = Array.isArray(order.orderItems) ? order.orderItems : [];
  const isRoundOrder = typeof order.roundId === 'string' && order.roundId.length > 0;
  if (items.length === 0 || (!isRoundOrder && items.length < 2)) return null;
  return items.map((item, index) => ({
    key: `${item?.roundItemId ?? item?.productId ?? 'item'}:${index}`,
    productName: itemProductName(item) ?? '(상품 정보 없음)',
    quantity:
      typeof item?.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 0,
    subtotalAmount:
      typeof item?.subtotalAmount === 'number' && Number.isFinite(item.subtotalAmount)
        ? item.subtotalAmount
        : null,
  }));
}

/** 주문 카드의 상품 한 줄 요약. 상품이 여러 개면 "첫 상품명 외 N종". */
export function summarizeOrderProducts(
  order: Pick<Order, 'productName' | 'orderItems'>,
): string | null {
  const items = Array.isArray(order.orderItems) ? order.orderItems : [];
  if (items.length > 1) {
    const firstName = itemProductName(items[0]) ?? order.productName ?? '상품';
    return `${firstName} 외 ${items.length - 1}종`;
  }
  return order.productName || itemProductName(items[0]);
}

// tel: 링크에는 숫자와 맨 앞 +만 남긴다. 숫자가 없으면 링크를 만들지 않는다.
export function toTelHref(phone: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${digits}`;
}
