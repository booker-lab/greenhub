// Driver-facing order projection. Single owner for what a driver may see of an
// order; both the driver endpoints and the generic order read reuse it so the
// stage-based masking of customer contact data cannot diverge.

export type DriverOrderView = 'list' | 'detail';
export type DriverOrderReadModel = Record<string, unknown> & {
  redeliveryPayment: {
    required: boolean;
    holdAt: string | null;
    chargeId: string | null;
    status: string;
    canPay: boolean;
    paid: boolean;
    requiresRecovery: boolean;
  };
};

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

export function projectDriverOrder(
  order: Record<string, any>,
  driverId: string,
  view: DriverOrderView,
): DriverOrderReadModel {
  const isAssignedToRequester = order['driverId'] === driverId;
  const projected: DriverOrderReadModel = {
    id: order['id'],
    status: order['status'],
    deliveryMethod: order['deliveryMethod'],
    buyerName: order['buyerName'],
    address: order['address'] ?? deliveryAddressValue(order['deliveryAddress']),
    hubName: order['hubName'],
    hubAddress: order['hubAddress'],
    productName: order['productName'],
    quantity: order['quantity'],
    preparedAt: order['preparedAt'],
    updatedAt: order['updatedAt'],
    lat: order['lat'],
    lng: order['lng'],
    redeliveryPayment: projectRedeliveryPayment(order['redeliveryPayment']),
  };

  if (view === 'list') return projected;

  projected['storeId'] = order['storeId'];
  projected['schemaVersion'] = order['schemaVersion'];
  projected['roundId'] = order['roundId'];

  const deliveryAddress = projectDeliveryAddress(order['deliveryAddress']);
  if (deliveryAddress) projected['deliveryAddress'] = deliveryAddress;

  // 요청사항에는 받는 분 정보가 들어갈 수 있어 배정된 기사에게만 보인다.
  if (isAssignedToRequester && typeof order['requestNote'] === 'string') {
    projected['requestNote'] = order['requestNote'];
  }

  if (order['status'] === 'DELIVERY_HELD') {
    const deliveryHold = projectDeliveryHold(order['deliveryHold']);
    if (deliveryHold) projected['deliveryHold'] = deliveryHold;
  }

  if (
    isAssignedToRequester &&
    (order['status'] === 'PREPARING' ||
      (order['status'] === 'DELIVERING' && order['deliveryMethod'] === 'hub'))
  ) {
    projected['sellerPhone'] = order['sellerPhone'];
  }
  // 고객 전화는 본인 배정 직배송 주문의 배송 중·보류(재배송 연락) 단계에서만 노출한다.
  // 값은 결제 때 받은 수령 연락처(deliveryPhone)를 우선하고, 없으면 가입 프로필 전화로 대체한다.
  if (
    isAssignedToRequester &&
    (order['status'] === 'DELIVERING' || order['status'] === 'DELIVERY_HELD') &&
    order['deliveryMethod'] !== 'hub'
  ) {
    projected['buyerPhone'] = order['deliveryPhone'] ?? order['buyerPhone'];
  }

  return projected;
}

function projectRedeliveryPayment(payment: unknown): DriverOrderReadModel['redeliveryPayment'] {
  if (!isRecord(payment)) {
    return {
      required: false,
      holdAt: null,
      chargeId: null,
      status: 'NOT_REQUIRED',
      canPay: false,
      paid: false,
      requiresRecovery: false,
    };
  }
  return {
    required: payment['required'],
    holdAt: payment['holdAt'],
    chargeId: payment['chargeId'],
    status: payment['status'],
    canPay: payment['canPay'],
    paid: payment['paid'],
    requiresRecovery: payment['requiresRecovery'],
  };
}

function projectDeliveryAddress(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return { address: value['address'] };
}

function deliveryAddressValue(value: unknown): unknown {
  return isRecord(value) ? value['address'] : undefined;
}

function projectDeliveryHold(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return {
    reasonCode: value['reasonCode'],
    reasonMessage: value['reasonMessage'],
    customerResponsible: value['customerResponsible'],
    redeliveryFee: value['redeliveryFee'],
    nextContactAt: value['nextContactAt'],
    nextDeliveryAt: value['nextDeliveryAt'],
  };
}
