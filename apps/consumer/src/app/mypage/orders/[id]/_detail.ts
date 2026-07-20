import type { OrderStatus } from '@greenhub/shared';

const MAX_IDENTIFIER_LENGTH = 128;
const UNSAFE_IDENTIFIER_CHARACTERS = '/?#\\';
const ROUND_ORDER_NUMBER_PATTERN = /^\d{8}-\d{6}$/;
const ORDER_STATUSES = new Set<OrderStatus>([
  'PENDING',
  'RECRUITING',
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'DELIVERING',
  'DELIVERY_HELD',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'CANCELLED',
  'REVIEWED',
]);
const ROUND_CANCELLABLE_STATUSES = new Set<OrderStatus>([
  'PENDING',
  'ACCEPTED',
  'RECRUITING',
  'CONFIRMED',
  'PREPARING',
  'DELIVERY_HELD',
]);
const DELIVERY_HOLD_REASONS = new Set([
  'WEATHER',
  'ACCESS_UNAVAILABLE',
  'ADDRESS_ISSUE',
  'CUSTOMER_UNREACHABLE',
  'OTHER',
]);

export interface DetailItem {
  id: string;
  productName: string;
  quantity: number;
  subtotalAmount: number;
}

export interface DeliveryHoldView {
  heldAt: string;
  reasonMessage: string;
  customerResponsible: boolean;
  redeliveryFee: number | null;
  nextContactAt: string | null;
  nextDeliveryAt: string | null;
}

export interface OrderDetailView {
  id: string;
  orderNumber: string;
  storeId: string;
  status: OrderStatus;
  saleType: 'normal' | 'group';
  deliveryMethod: 'direct' | 'hub' | 'parcel';
  deliveryFee: number;
  totalAmount: number;
  deliveryAddress: { address: string; addressDetail: string } | null;
  requestedDeliveryDate: string | null;
  pickupCode: string | null;
  cancelReason: string | null;
  isRoundOrder: boolean;
  items: DetailItem[];
  deliveryHold: DeliveryHoldView | null;
  deliveryPhotoUrl: string | null;
  canPayRedeliveryFee: boolean;
  canRequestCancellation: boolean;
}

export interface RedeliveryPayment {
  paymentId: string;
  amount: number;
  name: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isSafeIdentifier(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value) {
    return false;
  }
  return ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || UNSAFE_IDENTIFIER_CHARACTERS.includes(character);
  });
}

function isMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function readNullableIso(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isNonEmptyString(value) || Number.isNaN(new Date(value).getTime())) return undefined;
  return value;
}

function readHttpsUrl(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isNonEmptyString(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function readItems(value: unknown, requireRoundItemId: boolean): DetailItem[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items: DetailItem[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isSafeIdentifier(item.productId) ||
      !isNonEmptyString(item.productName) ||
      !isMoney(item.unitPrice) ||
      !isPositiveQuantity(item.quantity) ||
      !isMoney(item.subtotalAmount) ||
      item.unitPrice * item.quantity !== item.subtotalAmount
    ) {
      return null;
    }
    const id = requireRoundItemId ? item.roundItemId : (item.roundItemId ?? item.productId);
    if (!isSafeIdentifier(id)) return null;
    items.push({
      id,
      productName: item.productName.trim(),
      quantity: item.quantity,
      subtotalAmount: item.subtotalAmount,
    });
  }
  return new Set(items.map((item) => item.id)).size === items.length ? items : null;
}

function readDeliveryHold(value: unknown): DeliveryHoldView | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.heldAt) ||
    Number.isNaN(new Date(value.heldAt).getTime()) ||
    typeof value.reasonCode !== 'string' ||
    !DELIVERY_HOLD_REASONS.has(value.reasonCode) ||
    !isNonEmptyString(value.reasonMessage) ||
    typeof value.customerResponsible !== 'boolean' ||
    (value.redeliveryFee !== null && !isMoney(value.redeliveryFee))
  ) {
    return null;
  }
  const nextContactAt = readNullableIso(value.nextContactAt);
  const nextDeliveryAt = readNullableIso(value.nextDeliveryAt);
  if (nextContactAt === undefined || nextDeliveryAt === undefined) return null;
  return {
    heldAt: value.heldAt,
    reasonMessage: value.reasonMessage.trim(),
    customerResponsible: value.customerResponsible,
    redeliveryFee: value.redeliveryFee as number | null,
    nextContactAt,
    nextDeliveryAt,
  };
}

function readAddress(value: unknown) {
  if (!isRecord(value) || !isNonEmptyString(value.address)) return null;
  if (value.addressDetail !== undefined && typeof value.addressDetail !== 'string') return null;
  return { address: value.address.trim(), addressDetail: value.addressDetail?.trim() ?? '' };
}

export function readOrderDetail(value: unknown, requestedOrderId: string): OrderDetailView | null {
  if (
    !isRecord(value) ||
    !isSafeIdentifier(requestedOrderId) ||
    value.id !== requestedOrderId ||
    !isSafeIdentifier(value.storeId) ||
    typeof value.status !== 'string' ||
    !ORDER_STATUSES.has(value.status as OrderStatus) ||
    !['normal', 'group'].includes(String(value.saleType)) ||
    !['direct', 'hub', 'parcel'].includes(String(value.deliveryMethod)) ||
    !isMoney(value.deliveryFee) ||
    !isMoney(value.totalAmount)
  ) {
    return null;
  }

  const status = value.status as OrderStatus;
  const isRoundOrder =
    value.schemaVersion === 2 || (value.roundId !== undefined && value.roundId !== null);
  const items = readItems(value.orderItems, isRoundOrder);
  const address = readAddress(value.deliveryAddress);
  const requestedDeliveryDate = readNullableIso(value.requestedDeliveryDate);
  if (requestedDeliveryDate === undefined) return null;

  if (isRoundOrder) {
    if (
      value.schemaVersion !== 2 ||
      !isSafeIdentifier(value.roundId) ||
      typeof value.orderNumber !== 'string' ||
      !ROUND_ORDER_NUMBER_PATTERN.test(value.orderNumber) ||
      value.saleType !== 'normal' ||
      value.deliveryMethod !== 'direct' ||
      value.deliveryFee !== 0 ||
      !items ||
      !address
    ) {
      return null;
    }
    const itemTotal = items.reduce((sum, item) => sum + item.subtotalAmount, 0);
    if (!Number.isSafeInteger(itemTotal) || itemTotal !== value.totalAmount) return null;
  }

  const deliveryHold = status === 'DELIVERY_HELD' ? readDeliveryHold(value.deliveryHold) : null;
  if (status === 'DELIVERY_HELD' && !deliveryHold) return null;
  const rawPhotoUrl =
    status === 'DELIVERED' || status === 'REVIEWED' ? readHttpsUrl(value.deliveryPhotoUrl) : null;
  if (rawPhotoUrl === undefined) return null;
  const canPayRedeliveryFee =
    isRoundOrder &&
    status === 'DELIVERY_HELD' &&
    deliveryHold?.customerResponsible === true &&
    typeof deliveryHold.redeliveryFee === 'number' &&
    deliveryHold.redeliveryFee > 0;

  return {
    id: requestedOrderId,
    orderNumber:
      typeof value.orderNumber === 'string' && value.orderNumber.length > 0
        ? value.orderNumber
        : requestedOrderId,
    storeId: value.storeId,
    status,
    saleType: value.saleType as 'normal' | 'group',
    deliveryMethod: value.deliveryMethod as 'direct' | 'hub' | 'parcel',
    deliveryFee: value.deliveryFee,
    totalAmount: value.totalAmount,
    deliveryAddress: address,
    requestedDeliveryDate,
    pickupCode: typeof value.pickupCode === 'string' ? value.pickupCode : null,
    cancelReason: typeof value.cancelReason === 'string' ? value.cancelReason : null,
    isRoundOrder,
    items: items ?? [],
    deliveryHold,
    deliveryPhotoUrl: rawPhotoUrl,
    canPayRedeliveryFee,
    canRequestCancellation: isRoundOrder
      ? ROUND_CANCELLABLE_STATUSES.has(status)
      : status === 'RECRUITING',
  };
}

export function readRedeliveryPaymentResponse(
  value: unknown,
  expected: { orderId: string; storeId: string; amount: number },
): RedeliveryPayment {
  if (
    !isRecord(value) ||
    !isSafeIdentifier(value.id) ||
    value.orderId !== expected.orderId ||
    value.storeId !== expected.storeId ||
    value.type !== 'REDELIVERY_FEE' ||
    value.status !== 'PENDING' ||
    value.customerResponsible !== true ||
    value.amount !== expected.amount ||
    !isRecord(value.portonePaymentParams)
  ) {
    throw new Error('재배송비 결제 응답을 확인할 수 없습니다.');
  }
  const params = value.portonePaymentParams;
  if (
    params.paymentId !== `order-charge-${value.id}` ||
    params.amount !== expected.amount ||
    !isNonEmptyString(params.name)
  ) {
    throw new Error('재배송비 결제 정보가 주문과 일치하지 않습니다.');
  }
  return { paymentId: params.paymentId, amount: expected.amount, name: params.name.trim() };
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}
