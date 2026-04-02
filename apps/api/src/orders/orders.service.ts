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
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { SettlementsService } from '../settlements/settlements.service';
import {
  generatePickupCode,
  detectMetropolitan,
  calcDeliveryFee,
  getAllowedTransitions,
  NOTIFICATION_MAP,
} from './orders.helpers';

@Injectable()
export class OrdersService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly notifications: NotificationsService,
    private readonly payments: PaymentsService,
    private readonly settlements: SettlementsService,
  ) {}

  async createOrder(storeId: string, userId: string, dto: CreateOrderDto) {
    // 공동구매 동의 검증
    if (dto.saleType === 'group' && !dto.groupBuyConsent?.agreed) {
      throw new BadRequestException('공동구매 동의가 필요합니다.');
    }

    // hub 배송 시 hubId 필수
    if (dto.deliveryMethod === 'hub' && !dto.hubId) {
      throw new BadRequestException('거점 배송 시 hubId가 필요합니다.');
    }

    const [product, userSnap] = await Promise.all([
      this.firestore.doc(`products/${dto.productId}`).get(),
      this.firestore.doc(`users/${userId}`).get(),
    ]);
    if (!product.exists || product.data()!['storeId'] !== storeId) {
      throw new NotFoundException('상품을 찾을 수 없습니다.');
    }
    const productData = product.data()!;
    const buyerName: string = userSnap.data()?.['name'] ?? userId;

    // 배송비 계산
    const deliveryConfig = await this.getDeliveryConfig(storeId);
    const deliveryFee = calcDeliveryFee(
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

      // 공동구매: 참여자 수 증가 + 최대 인원 검증
      if (dto.saleType === 'group') {
        const gcRef = this.firestore.doc(
          `groupProductConfig/${dto.productId}`,
        );
        const gcSnap = await t.get(gcRef);
        if (gcSnap.exists) {
          const gc = gcSnap.data()!;
          if (gc['currentParticipants'] >= gc['maxParticipants']) {
            throw new ConflictException('공동구매 모집 인원이 마감되었습니다.');
          }
          t.update(gcRef, {
            currentParticipants: gc['currentParticipants'] + 1,
          });
        }
      }

      const isMetropolitan = detectMetropolitan(dto.deliveryAddress.address);

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
        hubId: dto.deliveryMethod === 'hub' ? (dto.hubId ?? null) : null,
        pickupCode:
          dto.deliveryMethod === 'hub' ? generatePickupCode() : null,
        totalAmount: productData['price'] * dto.quantity + deliveryFee,
        requestedDeliveryDate: dto.requestedDeliveryDate ?? null,
        preparedAt: null,
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

    return {
      orderId,
      portonePaymentParams: {
        name: productData['name'],
        amount: productData['price'] * dto.quantity + deliveryFee,
        buyerName,
      },
    };
  }

  async getOrder(storeId: string, orderId: string, requesterId: string) {
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException('주문을 찾을 수 없습니다.');
    }
    const order = snap.data()!;
    if (order['userId'] !== requesterId) {
      const userSnap = await this.firestore.doc(`users/${requesterId}`).get();
      const userData = userSnap.data();
      const role = userData?.['role'];
      // admin·seller·driver는 타인 주문 조회 허용
      if (role !== 'seller' && role !== 'driver' && role !== 'admin') {
        throw new ForbiddenException();
      }
      // 판매자는 자신의 storeId 주문만 조회 가능 (admin·driver는 제한 없음)
      if (role === 'seller' && userData?.['storeId'] !== storeId) {
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
    const userSnap = await this.firestore.doc(`users/${requesterId}`).get();
    const userData = userSnap.data();
    const role = userData?.['role'];

    // 판매자는 자신의 storeId 주문만 조회 가능 (admin·driver는 storeId 제한 없음)
    if (role === 'seller' && userData?.['storeId'] !== storeId) {
      throw new ForbiddenException();
    }

    let ref = this.firestore
      .collection('orders')
      .where('storeId', '==', storeId) as any;

    if (query.userId) ref = ref.where('userId', '==', query.userId);
    if (query.status) ref = ref.where('status', '==', query.status);
    if (query.saleType) ref = ref.where('saleType', '==', query.saleType);

    const snap = await ref.get();
    return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
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

    const allowed = getAllowedTransitions(role, currentStatus);
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
    if (dto.status === 'PREPARING' && dto.preparedAt) {
      const date = new Date(dto.preparedAt);
      if (isNaN(date.getTime())) {
        throw new BadRequestException('preparedAt must be a valid ISO8601 date');
      }
      update['preparedAt'] = this.firestore.Timestamp.fromDate(date);
    }
    // DELIVERING 전환 시 driverId 자동 기록
    if (dto.status === 'DELIVERING') {
      update['driverId'] = requesterId;
    }
    // HUB_ARRIVED 전환 시 photoUrl 저장
    if (dto.status === 'HUB_ARRIVED' && dto.photoUrl) {
      update['deliveryPhotoUrl'] = dto.photoUrl;
    }

    await this.firestore.doc(`orders/${orderId}`).update(update);

    // 판매자 강제 취소 → 환불 + settlement 취소 반영
    if (dto.status === 'CANCELLED') {
      const refundableStatuses: OrderStatus[] = [
        'ACCEPTED',
        'RECRUITING',
        'CONFIRMED',
        'PREPARING',
      ];
      if (refundableStatuses.includes(currentStatus)) {
        await this.payments.processRefundByOrderId(orderId, dto.reason ?? '판매자 취소');
      }
      await this.settlements.cancelSettlement(orderId);
    }

    // DELIVERED 전환 시 정산 자동 생성
    if (dto.status === 'DELIVERED') {
      await this.settlements.createSettlement(order, 'DELIVERED');
    }

    // 알림 발송
    await this.sendTransitionNotification(order, currentStatus, dto.status, orderId);

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

    const cancelReason = reason ?? '소비자 취소';

    // Portone 환불
    await this.payments.processRefundByOrderId(orderId, cancelReason);

    // 주문 상태 + 공동구매 참여자 수 원자적 업데이트
    const gcRef = this.firestore.doc(
      `groupProductConfig/${order['productId']}`,
    );
    const now = this.firestore.Timestamp.now();

    await this.firestore.runTransaction(async (t) => {
      t.update(this.firestore.doc(`orders/${orderId}`), {
        status: 'CANCELLED',
        cancelReason,
        updatedAt: now,
      });
      const gcSnap = await t.get(gcRef);
      if (gcSnap.exists) {
        t.update(gcRef, {
          currentParticipants: this.firestore.FieldValue.increment(-1),
        });
      }
    });

    // settlement 취소 반영 (안전망: 정상 플로우에서는 settlement 미생성 상태)
    await this.settlements.cancelSettlement(orderId);

    // 소비자 본인 알림
    await this.notifications.sendToUser(
      userId,
      'GROUP_CANCELLED_SELF',
      { orderId, productId: order['productId'] as string },
      orderId,
    );

    return { orderId, status: 'CANCELLED' };
  }

  async reviewOrder(storeId: string, orderId: string, userId: string) {
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException();
    }
    const order = snap.data()!;
    if (order['userId'] !== userId) throw new ForbiddenException();

    const reviewableStatuses = ['DELIVERED', 'PICKED_UP'];
    if (!reviewableStatuses.includes(order['status'])) {
      throw new BadRequestException('DELIVERED 또는 PICKED_UP 상태에서만 리뷰 가능합니다.');
    }

    await this.firestore.doc(`orders/${orderId}`).update({
      status: 'REVIEWED',
      updatedAt: this.firestore.Timestamp.now(),
    });

    // 정산 자동 생성
    await this.settlements.createSettlement(order, 'REVIEWED');

    return { orderId, status: 'REVIEWED' };
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

    // 정산 자동 생성
    await this.settlements.createSettlement(order, 'PICKED_UP');

    return { orderId, status: 'PICKED_UP' };
  }

  async hubConfirmPickup(
    storeId: string,
    orderId: string,
    requesterId: string,
    pickupCode: string,
  ) {
    // seller 소유권 검증
    const storeSnap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!storeSnap.exists || storeSnap.data()?.['ownerId'] !== requesterId) {
      throw new ForbiddenException('해당 스토어에 대한 권한이 없습니다');
    }

    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException();
    }
    const order = snap.data()!;

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

    await this.settlements.createSettlement(order, 'PICKED_UP');

    return { orderId, status: 'PICKED_UP' };
  }

  // ────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────

  private async sendTransitionNotification(
    order: Record<string, unknown>,
    from: OrderStatus,
    to: OrderStatus,
    orderId: string,
  ) {
    const isGroup = order['saleType'] === 'group';

    // 공동구매 전용 템플릿 오버라이드 (스펙: 전체 참여자 알림 필요)
    const GROUP_TEMPLATE_OVERRIDES: Partial<Record<OrderStatus, Partial<Record<OrderStatus, string>>>> = {
      PREPARING: { DELIVERING: 'GROUP_DELIVERING' },
      DELIVERING: { DELIVERED: 'GROUP_DELIVERED' },
    };

    const templateCode: string | null =
      (isGroup ? GROUP_TEMPLATE_OVERRIDES[from]?.[to] : null) ??
      NOTIFICATION_MAP[from]?.[to] ??
      (to === 'CANCELLED' ? 'ORDER_CANCELLED' : null);

    if (!templateCode) return;

    const variables: Record<string, string> = { orderId };
    const GROUP_TEMPLATES = ['GROUP_PREPARING', 'GROUP_DELIVERING', 'GROUP_DELIVERED', 'GROUP_CONFIRMED'];

    if (isGroup && GROUP_TEMPLATES.includes(templateCode)) {
      await this.notifications.sendToGroupParticipants(
        order['productId'] as string,
        templateCode as any,
        variables,
      );
    } else {
      await this.notifications.sendToUser(
        order['userId'] as string,
        templateCode as any,
        variables,
        orderId,
      );
    }
  }

  private async getDeliveryConfig(
    storeId: string,
  ): Promise<Record<string, number>> {
    const snap = await this.firestore.doc(`deliveryFeeConfig/${storeId}`).get();
    return (snap.data() ?? {}) as Record<string, number>;
  }
}
