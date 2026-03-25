import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateStatusDto, OrderStatus } from './dto/update-status.dto';

// 판매자 허용 상태 전환
const SELLER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  ACCEPTED: ['PREPARING'],
  CONFIRMED: ['PREPARING'],
  PREPARING: ['CANCELLED'],
  DELIVERING: ['CANCELLED'],
  HUB_ARRIVED: ['CANCELLED'],
};

// 드라이버 허용 상태 전환
const DRIVER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PREPARING: ['DELIVERING'],
  DELIVERING: ['HUB_ARRIVED', 'DELIVERED'],
};

// 소비자 허용 상태 전환
const CONSUMER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  DELIVERED: ['REVIEWED'],
  PICKED_UP: ['REVIEWED'],
};

function generatePickupCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

@Injectable()
export class OrdersService {
  constructor(private readonly firestore: FirestoreService) {}

  async createOrder(storeId: string, userId: string, dto: CreateOrderDto) {
    // 공동구매 동의 검증
    if (dto.saleType === 'group' && !dto.groupBuyConsent?.agreed) {
      throw new BadRequestException('공동구매 동의가 필요합니다.');
    }

    const product = await this.firestore.doc(`products/${dto.productId}`).get();
    if (!product.exists || product.data()!['storeId'] !== storeId) {
      throw new NotFoundException('상품을 찾을 수 없습니다.');
    }
    const productData = product.data()!;

    // 배송비 계산
    const deliveryConfig = await this.getDeliveryConfig(storeId);
    const deliveryFee = this.calcDeliveryFee(
      dto.deliveryMethod,
      productData['deliverySize'],
      productData['price'] * dto.quantity,
      deliveryConfig,
    );

    const orderId = uuidv4();
    const now = this.firestore.Timestamp.now();
    const dateStr = new Date().toISOString().split('T')[0];
    const capId = `${storeId}_${dateStr}`;

    await this.firestore.runTransaction(async (t) => {
      // Daily Cap 검증 (hub/direct 배송만 슬롯 소모)
      if (dto.deliveryMethod !== 'parcel') {
        const capRef = this.firestore.doc(`dailyCaps/${capId}`);
        const capSnap = await t.get(capRef);

        if (capSnap.exists) {
          const cap = capSnap.data()!;
          if (cap['usedSlots'] + dto.quantity > cap['totalCap']) {
            throw new ConflictException('당일 배송 슬롯이 마감되었습니다.');
          }
          t.update(capRef, {
            usedSlots: cap['usedSlots'] + dto.quantity,
          });
        }
      }

      // 공동구매 참여자 수 증가
      if (dto.saleType === 'group') {
        const gcRef = this.firestore.doc(
          `groupProductConfig/${dto.productId}`,
        );
        const gcSnap = await t.get(gcRef);
        if (gcSnap.exists) {
          t.update(gcRef, {
            currentParticipants:
              (gcSnap.data()!['currentParticipants'] ?? 0) + 1,
          });
        }
      }

      const isMetropolitan = this.detectMetropolitan(
        dto.deliveryAddress.address,
      );

      t.set(this.firestore.doc(`orders/${orderId}`), {
        id: orderId,
        storeId,
        userId,
        productId: dto.productId,
        quantity: dto.quantity,
        saleType: dto.saleType,
        status: 'PENDING',
        deliveryMethod: dto.deliveryMethod,
        deliveryFee,
        deliveryAddress: dto.deliveryAddress,
        isMetropolitan,
        pickupCode:
          dto.deliveryMethod === 'hub' ? generatePickupCode() : null,
        totalAmount: productData['price'] * dto.quantity + deliveryFee,
        requestedDeliveryDate: dto.requestedDeliveryDate ?? null,
        cancelReason: null,
        groupBuyConsent: dto.groupBuyConsent
          ? {
              agreed: true,
              agreedAt: this.firestore.Timestamp.fromDate(
                new Date(dto.groupBuyConsent.agreedAt),
              ),
              userId,
            }
          : null,
        createdAt: now,
        updatedAt: now,
      });
    });

    // Portone 결제 파라미터 반환
    return {
      orderId,
      portonePaymentParams: {
        merchantUid: orderId,
        amount: productData['price'] * dto.quantity + deliveryFee,
        name: productData['name'],
        buyerName: userId,
      },
    };
  }

  async getOrder(storeId: string, orderId: string, requesterId: string) {
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException('주문을 찾을 수 없습니다.');
    }
    const order = snap.data()!;
    // 소비자는 본인 주문만, 판매자/드라이버는 해당 스토어 주문 조회 가능
    if (order['userId'] !== requesterId) {
      const userSnap = await this.firestore.doc(`users/${requesterId}`).get();
      const role = userSnap.data()?.['role'];
      if (role !== 'seller' && role !== 'driver') {
        throw new ForbiddenException();
      }
    }
    return order;
  }

  async getOrders(
    storeId: string,
    requesterId: string,
    query: { userId?: string; status?: string; saleType?: string },
  ) {
    let ref = this.firestore
      .collection('orders')
      .where('storeId', '==', storeId) as any;

    if (query.userId) ref = ref.where('userId', '==', query.userId);
    if (query.status) ref = ref.where('status', '==', query.status);
    if (query.saleType) ref = ref.where('saleType', '==', query.saleType);

    const snap = await ref.get();
    return { orders: snap.docs.map((d: any) => d.data()) };
  }

  async updateStatus(
    storeId: string,
    orderId: string,
    requesterId: string,
    dto: UpdateStatusDto,
  ) {
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException();
    }
    const order = snap.data()!;
    const currentStatus = order['status'] as OrderStatus;

    const userSnap = await this.firestore.doc(`users/${requesterId}`).get();
    const role = userSnap.data()?.['role'] ?? 'consumer';

    const allowed = this.getAllowedTransitions(role, currentStatus);
    if (!allowed.includes(dto.status)) {
      throw new ForbiddenException(
        `${currentStatus} → ${dto.status} 전환은 허용되지 않습니다.`,
      );
    }

    const update: Record<string, unknown> = {
      status: dto.status,
      updatedAt: this.firestore.Timestamp.now(),
    };
    if (dto.reason) update['cancelReason'] = dto.reason;

    await this.firestore.doc(`orders/${orderId}`).update(update);
    return { orderId, status: dto.status };
  }

  async cancelOrder(
    storeId: string,
    orderId: string,
    userId: string,
    reason?: string,
  ) {
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException();
    }
    const order = snap.data()!;

    if (order['userId'] !== userId) throw new ForbiddenException();
    if (order['status'] !== 'RECRUITING') {
      throw new ForbiddenException('RECRUITING 상태에서만 취소 가능합니다.');
    }

    await this.firestore.doc(`orders/${orderId}`).update({
      status: 'CANCELLED',
      cancelReason: reason ?? '소비자 취소',
      updatedAt: this.firestore.Timestamp.now(),
    });

    // 공동구매 참여자 수 감소
    const gcRef = this.firestore.doc(
      `groupProductConfig/${order['productId']}`,
    );
    const gcSnap = await gcRef.get();
    if (gcSnap.exists) {
      const current = gcSnap.data()!['currentParticipants'] ?? 1;
      await gcRef.update({ currentParticipants: Math.max(0, current - 1) });
    }

    return { orderId, status: 'CANCELLED' };
  }

  async confirmPickup(
    storeId: string,
    orderId: string,
    userId: string,
    pickupCode: string,
  ) {
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException();
    }
    const order = snap.data()!;
    if (order['userId'] !== userId) throw new ForbiddenException();
    if (order['status'] !== 'HUB_ARRIVED') {
      throw new BadRequestException('HUB_ARRIVED 상태에서만 픽업 확인 가능');
    }
    if (order['pickupCode'] !== pickupCode) {
      throw new BadRequestException('픽업 코드가 올바르지 않습니다.');
    }

    await this.firestore.doc(`orders/${orderId}`).update({
      status: 'PICKED_UP',
      updatedAt: this.firestore.Timestamp.now(),
    });
    return { orderId, status: 'PICKED_UP' };
  }

  // ────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────

  private getAllowedTransitions(role: string, current: OrderStatus): OrderStatus[] {
    if (role === 'seller') {
      return [
        ...(SELLER_TRANSITIONS[current] ?? []),
        'CANCELLED', // 판매자 강제 취소는 모든 상태에서 가능
      ];
    }
    if (role === 'driver') return DRIVER_TRANSITIONS[current] ?? [];
    return CONSUMER_TRANSITIONS[current] ?? [];
  }

  private detectMetropolitan(address: string): boolean {
    return /^(서울|경기)/.test(address);
  }

  private calcDeliveryFee(
    method: string,
    size: string,
    orderAmount: number,
    config: Record<string, number>,
  ): number {
    const sizeExtra: Record<string, number> = {
      small: 0,
      medium: 1000,
      large: 3000,
    };
    const baseFeeMap: Record<string, number> = {
      direct: config['directFee'] ?? 3000,
      hub: config['hubFee'] ?? 1000,
      parcel: config['parcelFee'] ?? 4000,
    };
    const freeThresholdMap: Record<string, number> = {
      direct: config['freeThresholdDirect'] ?? 50000,
      hub: config['freeThresholdHub'] ?? 30000,
      parcel: config['freeThresholdParcel'] ?? 50000,
    };

    const base = baseFeeMap[method] ?? 0;
    const extra = sizeExtra[size] ?? 0;
    const threshold = freeThresholdMap[method] ?? 0;

    if (orderAmount >= threshold) return 0;
    return base + extra;
  }

  private async getDeliveryConfig(
    storeId: string,
  ): Promise<Record<string, number>> {
    const snap = await this.firestore
      .doc(`deliveryFeeConfig/${storeId}`)
      .get();
    return (snap.data() ?? {}) as Record<string, number>;
  }
}
