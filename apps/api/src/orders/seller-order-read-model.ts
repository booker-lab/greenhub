export type SellerOrderReadView = 'list' | 'detail';

type OrderRecord = Record<string, any>;

const LIST_FIELDS = [
  'id',
  'storeId',
  'orderNumber',
  'productId',
  'productName',
  'quantity',
  'saleType',
  'status',
  'deliveryMethod',
  'deliveryFee',
  'totalAmount',
  'requestedDeliveryDate',
  // 회차 주문 구분(준비 물량 집계에서 회차 주문을 빼고 회차 구매 목록으로 보낸다).
  'roundId',
  'preparedAt',
  'pickupCode',
  'createdAt',
  'updatedAt',
  // 손님 이름은 상세와 같은 주문서 buyerName(주문 때 계정 이름을 복사한 값)을 그대로 쓴다.
  // 전화번호는 목록에 싣지 않는다. 목록 전화 검색은 서버에서 숫자 비교 후 주문만 돌려준다.
  'buyerName',
] as const;

const DETAIL_FIELDS = [
  ...LIST_FIELDS,
  'isMetropolitan',
  'hubId',
  'cancelReason',
  'requestNote',
] as const;

const DELIVERY_HOLD_FIELDS = [
  'heldAt',
  'reasonCode',
  'reasonMessage',
  'customerResponsible',
  'redeliveryFee',
  'nextContactAt',
  'nextDeliveryAt',
  'resolvedAt',
] as const;

const PAYMENT_FIELDS = [
  'required',
  'holdAt',
  'status',
  'canPay',
  'paid',
  'requiresRecovery',
] as const;

export function projectSellerOrder(order: OrderRecord, view: SellerOrderReadView) {
  const projected: OrderRecord = {};
  const fields = view === 'list' ? LIST_FIELDS : DETAIL_FIELDS;

  for (const field of fields) {
    if (order[field] !== undefined) projected[field] = order[field];
  }

  const firstItem = Array.isArray(order['orderItems']) ? order['orderItems'][0] : undefined;
  if (projected['productName'] === undefined && typeof firstItem?.['productName'] === 'string') {
    projected['productName'] = firstItem['productName'];
  }

  if (view === 'detail') {
    const deliveryAddress = projectFields(order['deliveryAddress'], [
      'address',
      'addressDetail',
      'zipCode',
    ]);
    if (deliveryAddress) projected['deliveryAddress'] = deliveryAddress;

    const deliveryHold = projectFields(order['deliveryHold'], DELIVERY_HOLD_FIELDS);
    if (deliveryHold) projected['deliveryHold'] = deliveryHold;

    const payment = projectFields(order['redeliveryPayment'], PAYMENT_FIELDS);
    if (payment) projected['redeliveryPayment'] = payment;

    if (Array.isArray(order['orderItems'])) {
      projected['orderItems'] = order['orderItems'].map((item: OrderRecord) =>
        projectFields(item, [
          'roundItemId',
          'productId',
          'productName',
          'productImageUrl',
          'unitPrice',
          'quantity',
          'subtotalAmount',
        ]),
      );
    }

    const deliveryPhone = sellerVisiblePhone(order);
    if (deliveryPhone !== undefined) projected['deliveryPhone'] = deliveryPhone;
  }

  return projected;
}

/**
 * 판매자에게 보이는 손님 연락처 — 결제 때 받은 수령 연락처(deliveryPhone)를 우선하고,
 * 없으면 가입 프로필 전화(buyerPhone)로 대체한다. 상세 표시와 목록 전화 검색이 같은 값을 쓴다.
 */
export function sellerVisiblePhone(order: OrderRecord): unknown {
  return order['deliveryPhone'] ?? order['buyerPhone'];
}

export const SELLER_PHONE_SEARCH_MIN_DIGITS = 4;
const SELLER_PHONE_SEARCH_MAX_DIGITS = 20;

/** 전화 검색어에서 숫자만 남긴다. 4~20자리가 아니면 null(검색 거부). */
export function normalizeSellerPhoneSearch(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < SELLER_PHONE_SEARCH_MIN_DIGITS) return null;
  if (digits.length > SELLER_PHONE_SEARCH_MAX_DIGITS) return null;
  return digits;
}

/** 판매자에게 보이는 연락처의 숫자에 검색 숫자가 들어 있으면 true. */
export function matchesSellerPhoneSearch(order: OrderRecord, digits: string): boolean {
  const phone = sellerVisiblePhone(order);
  if (typeof phone !== 'string') return false;
  return phone.replace(/\D/g, '').includes(digits);
}

function projectFields(value: unknown, fields: readonly string[]): OrderRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as OrderRecord;
  const projected: OrderRecord = {};
  for (const field of fields) {
    if (source[field] !== undefined) projected[field] = source[field];
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}
