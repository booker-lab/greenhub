import { Injectable } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import {
  DriverOrderScopeService,
  DRIVER_VISIBLE_STATUSES,
} from '../orders/driver-order-scope.service';
import { throwDriverOrderNotFound } from '../orders/driver-order-error';
import { OrdersQueryService } from '../orders/orders-query.service';

type DriverOrderView = 'list' | 'detail';
type DriverOrderReadModel = Record<string, unknown> & {
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

function timestampMillis(value: unknown): number | null {
  if (value == null) return null;
  if (isRecord(value) && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const millis = new Date(value).getTime();
    return Number.isNaN(millis) ? null : millis;
  }
  return null;
}

// preparedAt 오름차순, 없으면 updatedAt으로 대체하고 둘 다 없으면 뒤로 보낸다.
function compareByPreparedThenUpdated(a: Record<string, any>, b: Record<string, any>): number {
  const aKey = timestampMillis(a.preparedAt) ?? timestampMillis(a.updatedAt);
  const bKey = timestampMillis(b.preparedAt) ?? timestampMillis(b.updatedAt);
  if (aKey === bKey) return 0;
  if (aKey === null) return 1;
  if (bKey === null) return -1;
  return aKey - bKey;
}

@Injectable()
export class DriverService {
  private readonly driverScope: DriverOrderScopeService;

  constructor(
    private readonly firestore: FirestoreService,
    private readonly ordersQuery: OrdersQueryService,
    driverScope?: DriverOrderScopeService,
  ) {
    this.driverScope = driverScope ?? new DriverOrderScopeService(firestore);
  }

  async getOrders(driverId: string, statusQuery?: string) {
    const authority = await this.driverScope.assertDriverAuthority(driverId);
    const requestedStatuses = statusQuery
      ? statusQuery.split(',').filter((s) => DRIVER_VISIBLE_STATUSES.includes(s as any))
      : [...DRIVER_VISIBLE_STATUSES];

    if (requestedStatuses.length === 0) return [];

    // Firestore 'in' 쿼리로 노출 대상 status 동시 조회.
    // orderBy('preparedAt')는 필드가 없는 문서를 결과에서 제외한다. 회차 주문은 판매자가
    // 준비 시각을 입력하지 않으면 preparedAt이 없으므로 쿼리 정렬 대신 메모리에서 정렬한다.
    const snap = await this.firestore
      .collection('orders')
      .where('status', 'in', requestedStatuses)
      .get();

    const candidates = snap.docs
      .map((d: any) => ({ id: d.id, ...d.data() }))
      .sort(compareByPreparedThenUpdated);
    const visibility = await Promise.all(
      candidates.map((order: Record<string, unknown>) =>
        this.driverScope.isOrderVisible(order, driverId, authority),
      ),
    );
    const visibleOrders = candidates.filter((_, index) => visibility[index]);

    return Promise.all(visibleOrders.map((order) => this.toDriverOrder(order, driverId, 'list')));
  }

  async getOrder(driverId: string, orderId: string) {
    const authority = await this.driverScope.assertDriverAuthority(driverId);
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists) throwDriverOrderNotFound('주문을 찾을 수 없습니다.');

    const order = { id: orderId, ...snap.data() } as Record<string, unknown>;
    if (!(await this.driverScope.isOrderVisible(order, driverId, authority))) {
      throwDriverOrderNotFound('주문을 찾을 수 없습니다.');
    }

    return this.toDriverOrder(order, driverId, 'detail');
  }

  private async toDriverOrder(order: Record<string, any>, driverId: string, view: DriverOrderView) {
    const withPayment = await this.ordersQuery.withRedeliveryPayment(order);
    return this.projectOrder(withPayment, driverId, view);
  }

  private projectOrder(
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
      address: order['address'] ?? this.deliveryAddressValue(order['deliveryAddress']),
      hubName: order['hubName'],
      hubAddress: order['hubAddress'],
      productName: order['productName'],
      quantity: order['quantity'],
      preparedAt: order['preparedAt'],
      updatedAt: order['updatedAt'],
      lat: order['lat'],
      lng: order['lng'],
      redeliveryPayment: this.projectRedeliveryPayment(order['redeliveryPayment']),
    };

    if (view === 'list') return projected;

    projected['storeId'] = order['storeId'];
    projected['schemaVersion'] = order['schemaVersion'];
    projected['roundId'] = order['roundId'];

    const deliveryAddress = this.projectDeliveryAddress(order['deliveryAddress']);
    if (deliveryAddress) projected['deliveryAddress'] = deliveryAddress;

    if (order['status'] === 'DELIVERY_HELD') {
      const deliveryHold = this.projectDeliveryHold(order['deliveryHold']);
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

  private projectRedeliveryPayment(payment: unknown): DriverOrderReadModel['redeliveryPayment'] {
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

  private projectDeliveryAddress(value: unknown): Record<string, unknown> | undefined {
    if (!isRecord(value)) return undefined;
    return { address: value['address'] };
  }

  private deliveryAddressValue(value: unknown): unknown {
    return isRecord(value) ? value['address'] : undefined;
  }

  private projectDeliveryHold(value: unknown): Record<string, unknown> | undefined {
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
}
