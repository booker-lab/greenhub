import { Injectable } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import {
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
    return projectDriverOrder(withPayment, driverId, view);
  }
}
