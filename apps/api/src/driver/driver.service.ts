import { Injectable } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import {
  DRIVER_DISCOVERY_DELIVERY_METHODS,
  DRIVER_DISCOVERY_STATUS,
  DriverOrderScopeService,
  DRIVER_VISIBLE_STATUSES,
} from '../orders/driver-order-scope.service';
import { throwDriverOrderNotFound } from '../orders/driver-order-error';
import { type DriverOrderView, projectDriverOrder } from '../orders/driver-order-read-model';
import { OrdersQueryService } from '../orders/orders-query.service';

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
// 같은 시각이면 Firestore 기본 정렬과 같은 문서 ID 오름차순으로 둔다.
function compareByPreparedThenUpdated(a: Record<string, any>, b: Record<string, any>): number {
  const aKey = timestampMillis(a.preparedAt) ?? timestampMillis(a.updatedAt);
  const bKey = timestampMillis(b.preparedAt) ?? timestampMillis(b.updatedAt);
  if (aKey === bKey) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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

    // 노출 규칙상 보일 수 있는 주문은 본인 배정 주문과 미배정 discovery 후보뿐이다.
    // 다른 기사의 배송 중·보류 주문까지 전부 읽지 않도록 두 쿼리로 후보만 읽고, 노출 판정은 그대로 한다.
    // 미배정 주문은 driverId 필드 자체가 없을 수 있어(주문 생성 시 쓰지 않음) driverId == null로
    // 좁히지 않고, 모든 주문에 있는 status·deliveryMethod로 discovery 후보를 찾는다.
    // orderBy('preparedAt')는 필드가 없는 문서를 결과에서 제외한다. 회차 주문은 판매자가
    // 준비 시각을 입력하지 않으면 preparedAt이 없으므로 쿼리 정렬 대신 메모리에서 정렬한다.
    const orders = this.firestore.collection('orders');
    const reads = [
      orders.where('driverId', '==', driverId).where('status', 'in', requestedStatuses),
    ];
    if (requestedStatuses.includes(DRIVER_DISCOVERY_STATUS)) {
      reads.push(
        orders
          .where('status', '==', DRIVER_DISCOVERY_STATUS)
          .where('deliveryMethod', 'in', [...DRIVER_DISCOVERY_DELIVERY_METHODS]),
      );
    }
    const snaps = await Promise.all(reads.map((query) => query.get()));

    const byId = new Map<string, Record<string, any>>();
    for (const snap of snaps) {
      for (const d of snap.docs) {
        if (!byId.has(d.id)) byId.set(d.id, { id: d.id, ...d.data() });
      }
    }
    const candidates = [...byId.values()].sort(compareByPreparedThenUpdated);
    const visibleOrders = await this.driverScope.filterVisibleOrders(
      candidates,
      driverId,
      authority,
    );

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
    return projectDriverOrder(withPayment, driverId, view);
  }
}
