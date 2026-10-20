import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { FirestoreService } from '../firestore/firestore.service';
import { StorageService } from '../firestore/storage.service';
import {
  STORE_ORDER_ACTIVE_STATUSES,
  STORE_ORDER_ARCHIVED_STATUSES,
  STORE_ORDER_ID_PATTERN,
} from './dto/query-orders.dto';
import { projectDriverOrder } from './driver-order-read-model';
import { DriverOrderScopeService } from './driver-order-scope.service';
import {
  isCurrentRedeliveryPaymentRequired,
  resolveRedeliveryPaymentActionability,
} from './redelivery-resume-gate';
import {
  matchesSellerPhoneSearch,
  normalizeSellerPhoneSearch,
  projectSellerOrder,
  SELLER_PHONE_SEARCH_MIN_DIGITS,
} from './seller-order-read-model';

type OrderRequester = Pick<JwtPayload, 'sub' | 'role'>;
type OrderRequesterInput = OrderRequester | string;

export interface StoreOrdersQuery {
  userId?: string;
  status?: string;
  saleType?: string;
  phone?: string;
  scope?: string;
  roundId?: string;
  limit?: unknown;
  cursor?: string;
}

export const STORE_ORDER_PAGE_DEFAULT_LIMIT = 50;
export const STORE_ORDER_PAGE_MAX_LIMIT = 100;

export function resolveStoreOrderPageLimit(raw: unknown): number {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) return STORE_ORDER_PAGE_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(value), 1), STORE_ORDER_PAGE_MAX_LIMIT);
}

export type ArchivedOrderStatus = (typeof STORE_ORDER_ARCHIVED_STATUSES)[number];

@Injectable()
export class OrdersQueryService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly storage?: StorageService,
    private readonly driverScope: DriverOrderScopeService = new DriverOrderScopeService(firestore),
  ) {}

  async getOrder(storeId: string, orderId: string, requesterInput: OrderRequesterInput) {
    const requester = this.normalizeRequester(requesterInput);
    await this.assertStoreOrderReadAccess(storeId, requester);
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException('주문을 찾을 수 없습니다.');
    }
    const order = snap.data()!;
    if (requester.role === 'seller') {
      const withPayment = await this.withRedeliveryPayment({ id: orderId, ...order });
      return projectSellerOrder(withPayment, 'detail');
    }
    return this.withReadModel(orderId, order, requester);
  }

  async getOrders(storeId: string, requesterInput: OrderRequesterInput, query: StoreOrdersQuery) {
    const requester = this.normalizeRequester(requesterInput);
    await this.assertStoreOrderReadAccess(storeId, requester);
    this.assertOrderListQuery(query);
    if (query.scope === 'archive') {
      throw new BadRequestException('scope=archive는 끝난 주문 페이지 조회로 받습니다.');
    }

    const VALID_STATUSES = [
      'PENDING',
      'RECRUITING',
      'CONFIRMED',
      'ACCEPTED',
      'PREPARING',
      'DELIVERING',
      'HUB_ARRIVED',
      'PICKED_UP',
      'DELIVERED',
      'DELIVERY_HELD',
      'CANCELLED',
      'REVIEWED',
    ];
    const VALID_SALE_TYPES = ['normal', 'group'];

    if (query.status && !VALID_STATUSES.includes(query.status)) {
      throw new BadRequestException(`유효하지 않은 status: ${query.status}`);
    }
    if (query.saleType && !VALID_SALE_TYPES.includes(query.saleType)) {
      throw new BadRequestException(`유효하지 않은 saleType: ${query.saleType}`);
    }
    // 전화 검색: 목록 응답에 전화를 싣지 않고 서버에서 숫자만 비교해 맞는 주문만 돌려준다.
    const phoneDigits = query.phone === undefined ? null : normalizeSellerPhoneSearch(query.phone);
    if (query.phone !== undefined && phoneDigits === null) {
      throw new BadRequestException(
        `전화번호 검색은 숫자 ${SELLER_PHONE_SEARCH_MIN_DIGITS}자리 이상이어야 합니다.`,
      );
    }

    let ref = this.firestore.collection('orders').where('storeId', '==', storeId) as any;

    if (query.userId) {
      ref = ref.where('userId', '==', query.userId);
    }
    if (query.status) ref = ref.where('status', '==', query.status);
    if (query.saleType) ref = ref.where('saleType', '==', query.saleType);
    // 회차 주문: storeId·roundId 같음 조건만 쓴다(정렬 없음 — 화면이 정렬한다).
    if (query.roundId) ref = ref.where('roundId', '==', query.roundId);
    if (query.scope === 'active') {
      // 진행 중 주문만: 기존 (storeId, status, createdAt DESC) 색인을 쓴다.
      ref = ref.where('status', 'in', STORE_ORDER_ACTIVE_STATUSES).orderBy('createdAt', 'desc');
    } else if (
      requester.role === 'seller' &&
      !query.userId &&
      !query.status &&
      !query.saleType &&
      !query.roundId
    ) {
      ref = ref.orderBy('createdAt', 'desc');
    }

    const snap = await ref.get();
    const docs = phoneDigits
      ? snap.docs.filter((d: any) => matchesSellerPhoneSearch(d.data(), phoneDigits))
      : snap.docs;
    return this.projectOrderList(docs, requester);
  }

  /**
   * 끝난 주문(완료·취소)을 최신순으로 limit건씩 준다. 정산 목록과 같은 방식으로 앞 응답의 마지막 주문
   * 문서 다음부터 이어 받아 createdAt이 같은 주문도 빠지거나 겹치지 않는다.
   * 기존 (storeId, status, createdAt DESC) 색인을 쓴다.
   */
  async getArchivedOrders(
    storeId: string,
    requesterInput: OrderRequesterInput,
    query: StoreOrdersQuery,
  ) {
    const requester = this.normalizeRequester(requesterInput);
    await this.assertStoreOrderReadAccess(storeId, requester);
    this.assertOrderListQuery(query);
    if (query.scope !== 'archive') {
      throw new BadRequestException('끝난 주문 페이지 조회는 scope=archive만 받습니다.');
    }
    let ref = this.firestore
      .collection('orders')
      .where('storeId', '==', storeId)
      .where('status', 'in', STORE_ORDER_ARCHIVED_STATUSES)
      .orderBy('createdAt', 'desc') as any;
    if (query.cursor !== undefined) {
      ref = ref.startAfter(await this.readOrderCursor(storeId, query.cursor));
    }
    const limit = resolveStoreOrderPageLimit(query.limit);
    const snap = await ref.limit(limit + 1).get();
    const docs = snap.docs.slice(0, limit);
    const hasMore = snap.docs.length > limit;
    return {
      orders: await this.projectOrderList(docs, requester),
      hasMore,
      nextCursor: hasMore ? (docs[docs.length - 1].id as string) : null,
    };
  }

  /**
   * 끝난 주문(완료·취소) 상태별 건수. 목록을 내려받지 않고 Firestore 집계(count)로 센다.
   * 상태마다 기존 (storeId, status) 색인을 쓴다. 진행 중 주문 건수는 scope=active 목록에서 센다.
   */
  async getArchivedOrderCounts(storeId: string, requesterInput: OrderRequesterInput) {
    const requester = this.normalizeRequester(requesterInput);
    await this.assertStoreOrderReadAccess(storeId, requester);
    const entries = await Promise.all(
      STORE_ORDER_ARCHIVED_STATUSES.map(async (status) => {
        const snap = await this.firestore
          .collection('orders')
          .where('storeId', '==', storeId)
          .where('status', '==', status)
          .count()
          .get();
        const count = snap.data().count;
        return [status, typeof count === 'number' ? count : 0] as const;
      }),
    );
    return {
      archivedStatusCounts: Object.fromEntries(entries) as Record<ArchivedOrderStatus, number>,
    };
  }

  private assertOrderListQuery(query: StoreOrdersQuery) {
    const narrowed = query.scope !== undefined || query.roundId !== undefined;
    if (narrowed && (query.userId || query.status || query.saleType || query.phone !== undefined)) {
      throw new BadRequestException('scope·roundId는 다른 조회 조건과 함께 쓸 수 없습니다.');
    }
    if (query.scope !== undefined && query.roundId !== undefined) {
      throw new BadRequestException('scope와 roundId는 함께 쓸 수 없습니다.');
    }
    if ((query.limit !== undefined || query.cursor !== undefined) && query.scope !== 'archive') {
      throw new BadRequestException('limit·cursor는 scope=archive에서만 쓸 수 있습니다.');
    }
  }

  private async readOrderCursor(storeId: string, cursor: unknown) {
    if (typeof cursor !== 'string' || !STORE_ORDER_ID_PATTERN.test(cursor)) {
      throw new BadRequestException('cursor 값이 올바르지 않습니다.');
    }
    const cursorSnap = await this.firestore.doc(`orders/${cursor}`).get();
    // 다른 매장 주문을 기준점으로 쓰지 못하게 같은 매장 주문만 받는다.
    if (!cursorSnap.exists || cursorSnap.data()?.['storeId'] !== storeId) {
      throw new BadRequestException('cursor 값이 올바르지 않습니다.');
    }
    return cursorSnap;
  }

  private async projectOrderList(docs: any, requester: OrderRequester) {
    if (requester.role === 'seller') {
      return docs.map((d: any) => projectSellerOrder({ id: d.id, ...d.data() }, 'list'));
    }
    return Promise.all(docs.map((d: any) => this.withRedeliveryPayment({ id: d.id, ...d.data() })));
  }

  // ── Public (storeId-free) ─────────────────────────────────────────────────

  async getOrderById(orderId: string, requesterInput: OrderRequesterInput) {
    const requester = this.normalizeRequester(requesterInput);
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');
    const order = snap.data()!;

    await this.assertOrderReadAccess(order['storeId'], order, requester);
    if (requester.role === 'seller') {
      const withPayment = await this.withRedeliveryPayment({ id: orderId, ...order });
      return projectSellerOrder(withPayment, 'detail');
    }
    if (requester.role === 'driver') {
      // Same stage-based contact masking as the driver endpoints.
      const withPayment = await this.withRedeliveryPayment({ id: orderId, ...order });
      return projectDriverOrder(withPayment, requester.sub, 'detail');
    }
    return this.withReadModel(orderId, order, requester);
  }

  async getMyOrders(requesterId: string) {
    const snap = await this.firestore.collection('orders').where('userId', '==', requesterId).get();
    return Promise.all(
      snap.docs.map((d: any) => this.withRedeliveryPayment({ id: d.id, ...d.data() })),
    );
  }

  private async withReadModel(
    orderId: string,
    order: Record<string, any>,
    requester: OrderRequester,
  ) {
    const withPayment = await this.withRedeliveryPayment({ id: orderId, ...order });
    return this.withDeliveryPhotoUrl(orderId, withPayment, requester);
  }

  async withRedeliveryPayment(order: Record<string, any>) {
    const normalized = this.normalizeOrder(order);
    if (!isCurrentRedeliveryPaymentRequired(order)) {
      return {
        ...normalized,
        redeliveryPayment: resolveRedeliveryPaymentActionability({
          order,
          chargeExists: false,
        }),
      };
    }

    const chargeId = order['redeliveryChargeId'];
    if (typeof chargeId !== 'string' || chargeId.length === 0) {
      return {
        ...normalized,
        redeliveryPayment: resolveRedeliveryPaymentActionability({
          order,
          chargeExists: false,
        }),
      };
    }

    const chargeSnap = await this.firestore.doc(`orderCharges/${chargeId}`).get();
    return {
      ...normalized,
      redeliveryPayment: resolveRedeliveryPaymentActionability({
        order,
        chargeExists: chargeSnap.exists,
        charge: chargeSnap.exists ? chargeSnap.data() : undefined,
      }),
    };
  }

  private async assertStoreOrderReadAccess(storeId: string, requester: OrderRequester) {
    if (requester.role === 'admin') return;
    if (requester.role !== 'seller') {
      throw new ForbiddenException('판매자 주문 조회 권한이 없습니다.');
    }
    const storeSnap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!storeSnap.exists || storeSnap.data()?.['ownerId'] !== requester.sub) {
      throw new ForbiddenException('해당 스토어 주문을 조회할 권한이 없습니다.');
    }
  }

  private normalizeRequester(requester: OrderRequesterInput): OrderRequester {
    return typeof requester === 'string' ? { sub: requester, role: 'consumer' } : requester;
  }

  private async assertOrderReadAccess(
    storeId: string,
    order: Record<string, any>,
    requester: OrderRequester,
  ) {
    if (requester.role === 'admin') return;
    if (requester.role === 'consumer' && order['userId'] === requester.sub) return;
    if (requester.role === 'driver') {
      await this.driverScope.assertAssignedReadAccess(order, requester.sub, storeId);
      return;
    }
    if (requester.role === 'seller') {
      const storeSnap = await this.firestore.doc(`stores/${storeId}`).get();
      if (storeSnap.exists && storeSnap.data()?.['ownerId'] === requester.sub) return;
    }
    throw new ForbiddenException('해당 주문을 조회할 권한이 없습니다.');
  }

  private normalizeOrder(order: Record<string, any>): Record<string, any> {
    if (Array.isArray(order['orderItems']) && order['orderItems'].length > 0) {
      return {
        ...order,
        orderItems: order['orderItems'].map((item: Record<string, any>) => {
          const { lineAmount, ...normalized } = item;
          return {
            ...normalized,
            subtotalAmount:
              item['subtotalAmount'] ??
              lineAmount ??
              (typeof item['unitPrice'] === 'number' && typeof item['quantity'] === 'number'
                ? item['unitPrice'] * item['quantity']
                : null),
          };
        }),
      };
    }
    return {
      ...order,
      orderItems: [
        {
          productId: order['productId'],
          productName: order['productName'],
          productImageUrl: order['productImageUrl'] ?? null,
          unitPrice:
            typeof order['totalAmount'] === 'number' && typeof order['quantity'] === 'number'
              ? Math.max(0, order['totalAmount'] - (order['deliveryFee'] ?? 0)) / order['quantity']
              : null,
          quantity: order['quantity'] ?? 1,
          subtotalAmount:
            typeof order['totalAmount'] === 'number'
              ? order['totalAmount'] - (order['deliveryFee'] ?? 0)
              : null,
        },
      ],
    };
  }

  private async withDeliveryPhotoUrl(
    orderId: string,
    order: Record<string, any>,
    requester: OrderRequester,
  ) {
    const normalized = this.normalizeOrder(order);
    const isRoundDirect =
      order['schemaVersion'] === 2 &&
      typeof order['roundId'] === 'string' &&
      order['deliveryMethod'] === 'direct';
    if (!isRoundDirect) return normalized;

    const { deliveryPhotoUrl: _storedUrl, ...privatePhotoOrder } = normalized;
    if (!['DELIVERED', 'REVIEWED'].includes(order['status'])) {
      return privatePhotoOrder;
    }
    const photoId = Array.isArray(order['deliveryPhotoIds'])
      ? order['deliveryPhotoIds'].find(
          (value: unknown): value is string => typeof value === 'string' && value.length > 0,
        )
      : null;
    if (!photoId || !this.storage) return privatePhotoOrder;

    const signed = await this.storage.createDeliveryPhotoReadUrl({
      storeId: order['storeId'],
      orderId,
      photoId,
      requesterId: requester.sub,
      requesterRole: requester.role,
    });
    return { ...privatePhotoOrder, deliveryPhotoUrl: signed.url };
  }
}
