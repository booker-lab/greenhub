// Driver-facing order projection. Single owner for what a driver may see of an
// order; both the driver endpoints and the generic order read reuse it so the
// stage-based masking of customer contact data cannot diverge.

export type DriverOrderView = 'list' | 'detail';
// 주문 문서 밖에서 읽어 함께 싣는 값. 회차 배송 시작 시각은 노출 판정이 확인한 회차 문서에서 온다.
export type DriverOrderProjectionContext = { roundDeliveryStartAt?: string | null };
type DriverOrderItem = { productName: string; quantity: number };
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
  context: DriverOrderProjectionContext = {},
): DriverOrderReadModel {
  const isAssignedToRequester = order['driverId'] === driverId;
  const projected: DriverOrderReadModel = {
    id: order['id'],
    status: order['status'],
    // 요청한 기사 본인에게 배정됐는지만 싣는다(배정된 기사 ID는 싣지 않는다).
    assignedToMe: isAssignedToRequester,
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

  // 기사가 상품마다 챙길 개수를 보도록 상품 이름·수량만 싣는다(가격·상품 ID 등은 싣지 않는다).
  const items = projectItems(order['orderItems']);
  if (items) projected['items'] = items;

  // 회차 주문의 배송일 표시용. 회차 일정은 손님·기사 정보가 아니고 같은 회차 주문에 모두 같다.
  if (typeof context.roundDeliveryStartAt === 'string') {
    projected['deliveryDate'] = context.roundDeliveryStartAt;
  }

  if (view === 'list') {
    // 지도 검색용 기본 주소(동·호수 없는 deliveryAddress.address)는 전체 주소를 이미 싣는 행에만 싣는다.
    const deliveryAddress = projectDeliveryAddress(order['deliveryAddress']);
    if (deliveryAddress && projected['address'] != null) {
      projected['deliveryAddress'] = deliveryAddress;
    }
    return projected;
  }

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

// 하나라도 형식이 어긋나면 통째로 빼서, 앱이 기존 "첫 상품 · 총 N개" 표기로 대신하게 한다.
function projectItems(value: unknown): DriverOrderItem[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const items: DriverOrderItem[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item['productName'] !== 'string' ||
      item['productName'].trim().length === 0 ||
      !Number.isInteger(item['quantity']) ||
      item['quantity'] <= 0
    ) {
      return undefined;
    }
    items.push({ productName: item['productName'], quantity: item['quantity'] });
  }
  return items;
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
