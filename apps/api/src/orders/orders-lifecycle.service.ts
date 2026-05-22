import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { UpdateStatusDto, OrderStatus } from './dto/update-status.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { SettlementsService } from '../settlements/settlements.service';
import { getAllowedTransitions, NOTIFICATION_MAP } from './orders.helpers';

@Injectable()
export class OrdersLifecycleService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly notifications: NotificationsService,
    private readonly payments: PaymentsService,
    private readonly settlements: SettlementsService,
  ) {}

  async updateStatus(
    storeId: string,
    orderId: string,
    requesterId: string,
    dto: UpdateStatusDto,
    requesterRole?: string,
  ) {
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException();
    }
    const order = snap.data()!;
    const currentStatus = order['status'] as OrderStatus;

    // JWT role을 우선 사용, 없으면 Firestore fallback
    let role = requesterRole;
    if (!role) {
      const userSnap = await this.firestore.doc(`users/${requesterId}`).get();
      role = userSnap.data()?.['role'] ?? 'consumer';
    }

    const allowed = getAllowedTransitions(role ?? 'consumer', currentStatus);
    if (!allowed.includes(dto.status)) {
      throw new ForbiddenException(`${currentStatus} → ${dto.status} 전환은 허용되지 않습니다.`);
    }

    // BUG-16 T2: 셀러의 PREPARING → DELIVERED는 택배(parcel) 주문에서만 허용.
    // direct/hub 주문은 드라이버 수거(DELIVERING)를 거쳐야 하므로 셀러 임의 발송 완료 차단.
    if (
      role === 'seller' &&
      currentStatus === 'PREPARING' &&
      dto.status === 'DELIVERED' &&
      order['deliveryMethod'] !== 'parcel'
    ) {
      throw new ForbiddenException('택배 발송 완료는 택배 주문에서만 가능합니다.');
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

  async cancelOrder(storeId: string, orderId: string, userId: string, reason?: string) {
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
    const gcRef = this.firestore.doc(`groupProductConfig/${order['productId']}`);
    const now = this.firestore.Timestamp.now();

    await this.firestore.runTransaction(async (t) => {
      // read 먼저, write 나중 (Firestore 트랜잭션 규칙)
      const gcSnap = await t.get(gcRef);
      t.update(this.firestore.doc(`orders/${orderId}`), {
        status: 'CANCELLED',
        cancelReason,
        updatedAt: now,
      });
      if (gcSnap.exists) {
        t.update(gcRef, {
          currentQuantity: this.firestore.FieldValue.increment(-(order['quantity'] as number)),
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

  async confirmPickup(storeId: string, orderId: string, userId: string, pickupCode: string) {
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
    const GROUP_TEMPLATE_OVERRIDES: Partial<
      Record<OrderStatus, Partial<Record<OrderStatus, string>>>
    > = {
      PREPARING: { DELIVERING: 'GROUP_DELIVERING' },
      DELIVERING: { DELIVERED: 'GROUP_DELIVERED' },
    };

    const templateCode: string | null =
      (isGroup ? GROUP_TEMPLATE_OVERRIDES[from]?.[to] : null) ??
      NOTIFICATION_MAP[from]?.[to] ??
      (to === 'CANCELLED' ? 'ORDER_CANCELLED' : null);

    if (!templateCode) return;

    const variables: Record<string, string> = { orderId };
    const GROUP_TEMPLATES = [
      'GROUP_PREPARING',
      'GROUP_DELIVERING',
      'GROUP_DELIVERED',
      'GROUP_CONFIRMED',
    ];

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
}
