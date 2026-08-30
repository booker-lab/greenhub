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
  'preparedAt',
  'pickupCode',
  'createdAt',
  'updatedAt',
] as const;

const DETAIL_FIELDS = [
  ...LIST_FIELDS,
  'isMetropolitan',
  'hubId',
  'cancelReason',
  'buyerName',
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

    const deliveryPhone = order['deliveryPhone'] ?? order['buyerPhone'];
    if (deliveryPhone !== undefined) projected['deliveryPhone'] = deliveryPhone;
  }

  return projected;
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
