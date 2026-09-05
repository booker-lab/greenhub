import { Injectable, NotFoundException } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import {
  DriverOrderScopeService,
  DRIVER_VISIBLE_STATUSES,
} from '../orders/driver-order-scope.service';
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

    // Firestore 'in' 쿼리로 PREPARING + DELIVERING 동시 조회
    const snap = await this.firestore
      .collection('orders')
      .where('status', 'in', requestedStatuses)
      .orderBy('preparedAt', 'asc')
      .get();

    const candidates = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
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
    if (!snap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');

    const order = { id: orderId, ...snap.data() } as Record<string, unknown>;
    if (!(await this.driverScope.isOrderVisible(order, driverId, authority))) {
      throw new NotFoundException('주문을 찾을 수 없습니다.');
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
    if (
      isAssignedToRequester &&
      order['status'] === 'DELIVERING' &&
      order['deliveryMethod'] !== 'hub'
    ) {
      projected['buyerPhone'] = order['buyerPhone'];
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
