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
  isCurrentRedeliveryPaymentRequired,
  resolveRedeliveryPaymentActionability,
} from './redelivery-resume-gate';
import { projectSellerOrder } from './seller-order-read-model';

type OrderRequester = Pick<JwtPayload, 'sub' | 'role'>;
type OrderRequesterInput = OrderRequester | string;

@Injectable()
export class OrdersQueryService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly storage?: StorageService,
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

  async getOrders(
    storeId: string,
    requesterInput: OrderRequesterInput,
    query: { userId?: string; status?: string; saleType?: string },
  ) {
    const requester = this.normalizeRequester(requesterInput);
    await this.assertStoreOrderReadAccess(storeId, requester);

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

    let ref = this.firestore.collection('orders').where('storeId', '==', storeId) as any;

    if (query.userId) {
      ref = ref.where('userId', '==', query.userId);
    }
    if (query.status) ref = ref.where('status', '==', query.status);
    if (query.saleType) ref = ref.where('saleType', '==', query.saleType);
    if (requester.role === 'seller' && !query.userId && !query.status && !query.saleType) {
      ref = ref.orderBy('createdAt', 'desc');
    }

    const snap = await ref.get();
    if (requester.role === 'seller') {
      return snap.docs.map((d: any) => projectSellerOrder({ id: d.id, ...d.data() }, 'list'));
    }

    const orders = await Promise.all(
      snap.docs.map((d: any) => this.withRedeliveryPayment({ id: d.id, ...d.data() })),
    );
    return orders;
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
    if (requester.role === 'driver' && order['driverId'] === requester.sub) return;
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
