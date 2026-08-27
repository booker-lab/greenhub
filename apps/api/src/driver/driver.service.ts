import { Injectable, NotFoundException } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { OrdersQueryService } from '../orders/orders-query.service';

const DRIVER_VISIBLE_STATUSES = ['PREPARING', 'DELIVERING', 'DELIVERY_HELD'] as const;

@Injectable()
export class DriverService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly ordersQuery: OrdersQueryService,
  ) {}

  async getOrders(driverId: string, statusQuery?: string) {
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

    const visibleOrders = snap.docs
      .map((d: any) => ({ id: d.id, ...d.data() }))
      .filter((order: Record<string, unknown>) => this.isVisibleOrder(order, driverId));

    return Promise.all(visibleOrders.map((order) => this.ordersQuery.withRedeliveryPayment(order)));
  }

  async getOrder(driverId: string, orderId: string) {
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');

    const order = { id: orderId, ...snap.data() } as Record<string, unknown>;
    if (!this.isVisibleOrder(order, driverId)) {
      throw new NotFoundException('주문을 찾을 수 없습니다.');
    }

    return this.ordersQuery.withRedeliveryPayment(order);
  }

  private isVisibleOrder(order: Record<string, unknown>, driverId: string) {
    const isAssignedToRequester = order['driverId'] === driverId;
    if (isAssignedToRequester) {
      return DRIVER_VISIBLE_STATUSES.includes(order['status'] as (typeof DRIVER_VISIBLE_STATUSES)[number]);
    }

    return (
      order['status'] === 'PREPARING' &&
      order['driverId'] == null &&
      ['direct', 'hub'].includes(String(order['deliveryMethod']))
    );
  }
}
