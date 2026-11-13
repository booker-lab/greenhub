import { dateRangeKST, todayKST } from '@greenhub/shared';
import { Injectable } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { StorageService } from '../firestore/storage.service';
import {
  DRIVER_DISCOVERY_DELIVERY_METHODS,
  DRIVER_DISCOVERY_STATUS,
  DriverOrderScopeService,
  DRIVER_VISIBLE_STATUSES,
} from '../orders/driver-order-scope.service';
import { throwDriverOrderNotFound } from '../orders/driver-order-error';
import {
  type DriverCompletedOrder,
  type DriverOrderProjectionContext,
  type DriverOrderView,
  driverCompletedOrderPhotoId,
  projectDriverCompletedOrder,
  projectDriverOrder,
} from '../orders/driver-order-read-model';
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

/**
 * 노출 판정이 회차 직배송 기준으로 본 주문의 회차 문서에서 배송 시작 시각(ISO)을 꺼낸다.
 * 배송일은 표시용이라 회차 문서가 없거나 일정 값을 읽지 못하면 목록은 그대로 두고 배송일만 뺀다.
 */
function roundDeliveryStartAt(round: Record<string, any> | null): string | null {
  if (!round) return null;
  try {
    const schedule: unknown = round.schedule;
    const millis = isRecord(schedule) ? timestampMillis(schedule['deliveryStartAt']) : null;
    return millis === null ? null : new Date(millis).toISOString();
  } catch {
    return null;
  }
}

// 배송 완료 뒤 주문이 갈 수 있는 상태. 고객 리뷰(구매 확정)나 배송 후 환불로 상태가 넘어가도
// 배송 완료 시각(deliveredAt)이 오늘이면 오늘 완료로 센다.
export const DRIVER_COMPLETED_ORDER_STATUSES = ['DELIVERED', 'REVIEWED', 'CANCELLED'] as const;

/**
 * 주문의 배송 완료 시각(ms). 배송 완료 전이가 쓰는 deliveredAt을 쓰고, 그 필드를 쓰기 전에 완료된
 * 주문은 아직 DELIVERED에 머문 경우에만 마지막 변경 시각(updatedAt)으로 대신한다. 리뷰·취소로 넘어간
 * 이전 주문은 완료 시각을 알 수 없어 세지 않는다.
 */
function deliveredAtMillis(order: Record<string, unknown>): number | null {
  const deliveredAt = timestampMillis(order['deliveredAt']);
  if (deliveredAt !== null) return deliveredAt;
  return order['status'] === 'DELIVERED' ? timestampMillis(order['updatedAt']) : null;
}

function compareIdAsc(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const aId = String(a['id']);
  const bId = String(b['id']);
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

type CompletedTodayRange = { startMillis: number; endMillis: number };
type CompletedTodayEntry = { order: Record<string, unknown>; deliveredAt: number };

/**
 * 오늘 완료 판정의 단일 기준. 요약 수·완료 내역·사진 조회가 모두 이 판정을 써서 개수가 어긋나지 않는다.
 * 본인 배정, 완료 계열 상태, 오늘 바뀐 주문(쿼리 조건)을 메모리에서도 다시 확인하고 완료 시각이 오늘이어야 한다.
 */
function completedTodayDeliveredAt(
  order: Record<string, unknown>,
  driverId: string,
  { startMillis, endMillis }: CompletedTodayRange,
): number | null {
  if (order['driverId'] !== driverId) return null;
  if (!(DRIVER_COMPLETED_ORDER_STATUSES as readonly unknown[]).includes(order['status'])) {
    return null;
  }
  const updatedAt = timestampMillis(order['updatedAt']);
  if (updatedAt === null || updatedAt < startMillis) return null;
  const deliveredAt = deliveredAtMillis(order);
  if (deliveredAt === null || deliveredAt < startMillis || deliveredAt >= endMillis) return null;
  return deliveredAt;
}

@Injectable()
export class DriverService {
  private readonly driverScope: DriverOrderScopeService;

  constructor(
    private readonly firestore: FirestoreService,
    private readonly ordersQuery: OrdersQueryService,
    driverScope?: DriverOrderScopeService,
    private readonly storage?: StorageService,
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
    // 노출 판정이 이미 읽은 회차·판매점 문서를 그대로 받아 배송일과 수거 장소를 싣는다.
    // 회차·판매점 문서는 요청당 문서마다 한 번만 읽는다.
    const visibleEntries = await this.driverScope.filterVisibleOrdersWithRounds(
      candidates,
      driverId,
      authority,
    );

    return Promise.all(
      visibleEntries.map(({ order, pilotRound, store }) =>
        this.toDriverOrder(order, driverId, 'list', {
          roundDeliveryStartAt: roundDeliveryStartAt(pilotRound),
          pickupStore: store,
        }),
      ),
    );
  }

  async getOrder(driverId: string, orderId: string) {
    const authority = await this.driverScope.assertDriverAuthority(driverId);
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists) throwDriverOrderNotFound('주문을 찾을 수 없습니다.');

    const order = { id: orderId, ...snap.data() } as Record<string, unknown>;
    // 노출 판정이 읽은 판매점 문서로 수거 장소를 싣는다(판매점 문서를 다시 읽지 않는다).
    const visible = await this.driverScope.resolveVisibleOrder(order, driverId, authority);
    if (!visible) throwDriverOrderNotFound('주문을 찾을 수 없습니다.');

    return this.toDriverOrder(order, driverId, 'detail', { pickupStore: visible.store });
  }

  /**
   * 요청 기사에게 배정된 주문 중 오늘(서울 날짜) 배송 완료된 수. 손님 정보는 싣지 않는다.
   * 완료 내역(getCompletedToday)과 같은 읽기·판정(readCompletedToday)을 써서 수가 목록 길이와 같다.
   */
  async getSummary(driverId: string): Promise<{ completedToday: number }> {
    await this.driverScope.assertDriverAuthority(driverId);
    const { entries } = await this.readCompletedToday(driverId);
    return { completedToday: entries.length };
  }

  /**
   * 오늘(서울 날짜) 완료 내역. 요약 수와 같은 판정을 써서 목록 길이가 항상 completedToday와 같다.
   * 리뷰(REVIEWED)·배송 후 취소(CANCELLED)로 넘어간 주문도 status를 함께 실어 앱이 구분해 보이게 한다.
   */
  async getCompletedToday(
    driverId: string,
  ): Promise<{ date: string; orders: DriverCompletedOrder[] }> {
    await this.driverScope.assertDriverAuthority(driverId);
    const { date, entries } = await this.readCompletedToday(driverId);
    const orders = [...entries]
      .sort((a, b) => b.deliveredAt - a.deliveredAt || compareIdAsc(a.order, b.order))
      .map(({ order, deliveredAt }) =>
        projectDriverCompletedOrder(order, new Date(deliveredAt).toISOString()),
      );
    return { date, orders };
  }

  /**
   * 오늘 완료 주문의 배송 사진 서명 URL(15분). 본인 배정·오늘 완료·회차 직배송 사진이 있는 주문만
   * 허용하고, 그 밖에는 다른 기사 주문의 존재를 드러내지 않도록 모두 같은 404로 답한다.
   */
  async getCompletedTodayPhoto(
    driverId: string,
    orderId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const authority = await this.driverScope.assertDriverAuthority(driverId);
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists) throwDriverOrderNotFound('주문을 찾을 수 없습니다.');
    const order = { id: orderId, ...snap.data() } as Record<string, unknown>;
    const { start, endExclusive } = dateRangeKST(todayKST());
    const deliveredAt = completedTodayDeliveredAt(order, authority.requesterId, {
      startMillis: start.getTime(),
      endMillis: endExclusive.getTime(),
    });
    const photoId = deliveredAt === null ? null : driverCompletedOrderPhotoId(order);
    if (photoId === null || typeof order['storeId'] !== 'string' || !this.storage) {
      throwDriverOrderNotFound('배송 사진을 찾을 수 없습니다.');
    }

    // 판매자·기사 배송 사진 URL 경로(DeliveryPhotosController)와 같은 요청자 기준으로 서명한다.
    const { url, expiresAt } = await this.storage.createDeliveryPhotoReadUrl({
      storeId: order['storeId'],
      orderId,
      photoId,
      requesterId: authority.requesterId,
      requesterRole: authority.role,
    });
    return { url, expiresAt };
  }

  /**
   * 요청 기사에게 배정된 주문 중 오늘(서울 날짜) 배송 완료된 주문과 완료 시각.
   * 오늘 배송 완료된 주문은 그 뒤 리뷰·취소가 있어도 마지막 변경 시각이 오늘 이후이므로, 기존
   * (status, driverId, updatedAt) 복합 인덱스로 오늘 바뀐 본인 완료 계열 주문만 읽고 완료 시각으로 거른다.
   */
  private async readCompletedToday(
    driverId: string,
  ): Promise<{ date: string; entries: CompletedTodayEntry[] }> {
    const date = todayKST();
    const { start, endExclusive } = dateRangeKST(date);
    const snap = await this.firestore
      .collection('orders')
      .where('status', 'in', [...DRIVER_COMPLETED_ORDER_STATUSES])
      .where('driverId', '==', driverId)
      .where('updatedAt', '>=', this.firestore.Timestamp.fromDate(start))
      .get();

    const range = { startMillis: start.getTime(), endMillis: endExclusive.getTime() };
    const entries: CompletedTodayEntry[] = [];
    for (const doc of snap.docs) {
      const order = { id: doc.id, ...doc.data() } as Record<string, unknown>;
      // 쿼리 조건을 메모리에서도 다시 확인해, 조건 밖 문서가 섞여도 넣지 않는다.
      const deliveredAt = completedTodayDeliveredAt(order, driverId, range);
      if (deliveredAt !== null) entries.push({ order, deliveredAt });
    }
    return { date, entries };
  }

  private async toDriverOrder(
    order: Record<string, any>,
    driverId: string,
    view: DriverOrderView,
    context?: DriverOrderProjectionContext,
  ) {
    const withPayment = await this.ordersQuery.withRedeliveryPayment(order);
    return projectDriverOrder(withPayment, driverId, view, context);
  }
}
