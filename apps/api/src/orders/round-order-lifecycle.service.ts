import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { PaymentsService } from '../payments/payments.service';
import { SettlementsService } from '../settlements/settlements.service';
import { assertDeliveryHoldPolicy } from './delivery-hold-policy';
import type { OrderStatus, UpdateStatusDto } from './dto/update-status.dto';
import { OrderCapacityService } from './order-capacity.service';

type OrderRecord = Record<string, any>;

@Injectable()
export class RoundOrderLifecycleService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly payments: PaymentsService,
    private readonly settlements: SettlementsService,
    private readonly capacity: OrderCapacityService,
  ) {}

  async updateStatus(input: {
    storeId: string;
    orderId: string;
    expectedStatus: OrderStatus;
    dto: UpdateStatusDto;
    requesterId: string;
  }) {
    if (input.dto.status === 'CANCELLED') {
      return this.cancel({
        storeId: input.storeId,
        orderId: input.orderId,
        expectedStatus: input.expectedStatus,
        reason: input.dto.reason ?? '판매자 취소',
      });
    }

    const now = this.firestore.Timestamp.now();
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${input.orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== input.storeId) {
        throw new NotFoundException();
      }
      const order = orderSnap.data() as OrderRecord;
      if (order['status'] !== input.expectedStatus) {
        throw new ConflictException('주문 상태가 변경되었습니다.');
      }
      if (
        input.dto.status === 'DELIVERED' &&
        order['deliveryMethod'] === 'direct' &&
        (!Array.isArray(order['deliveryPhotoIds']) || order['deliveryPhotoIds'].length === 0)
      ) {
        throw new ForbiddenException('배송 사진 연결 후에만 배송을 완료할 수 있습니다.');
      }
      if (
        input.dto.status === 'DELIVERED' &&
        order['deliveryMethod'] === 'direct' &&
        input.dto.photoUrl
      ) {
        throw new BadRequestException('회차 직배송 사진은 공개 URL로 연결할 수 없습니다.');
      }

      const update = this.buildStatusUpdate(order, input.dto, input.requesterId, now);
      const heldOrderDelta =
        input.dto.status === 'DELIVERY_HELD'
          ? 1
          : input.expectedStatus === 'DELIVERY_HELD'
            ? -1
            : 0;
      if (heldOrderDelta !== 0) {
        const roundRef = this.firestore.doc(`saleRounds/${order['roundId']}`);
        const roundSnap = await tx.get(roundRef);
        if (!roundSnap.exists || roundSnap.data()?.['storeId'] !== input.storeId) {
          throw new NotFoundException('회차를 찾을 수 없습니다.');
        }
        const round = roundSnap.data() as OrderRecord;
        tx.update(roundRef, {
          counters: this.nextRoundCounters(round['counters'], heldOrderDelta),
          updatedAt: now,
        });
      }
      tx.update(orderRef, update);
    });
    return { orderId: input.orderId, status: input.dto.status };
  }

  async cancelByConsumer(input: {
    storeId: string;
    orderId: string;
    userId: string;
    reason?: string;
  }) {
    const orderSnap = await this.firestore.doc(`orders/${input.orderId}`).get();
    if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== input.storeId) {
      throw new NotFoundException();
    }
    const order = orderSnap.data() as OrderRecord;
    if (order['userId'] !== input.userId) throw new ForbiddenException();
    return this.cancel({
      storeId: input.storeId,
      orderId: input.orderId,
      expectedStatus: order['status'],
      reason: input.reason ?? '소비자 취소',
      requireOpenRound: true,
    });
  }

  async cancelForRound(input: {
    storeId: string;
    orderId: string;
    expectedStatus: OrderStatus;
    reason: string;
  }) {
    return this.cancel(input);
  }

  private async cancel(input: {
    storeId: string;
    orderId: string;
    expectedStatus: OrderStatus;
    reason: string;
    requireOpenRound?: boolean;
  }) {
    const claimed = await this.claimCancellation(input);
    if (claimed.done) return { orderId: input.orderId, status: 'CANCELLED' };

    if (claimed.needsRefund) {
      try {
        await this.payments.processRefundByOrderId(input.orderId, input.reason);
        await this.payments.refundOrderChargesByOrderId(input.orderId, input.reason);
      } catch (error) {
        await this.recordCancellationState(input.orderId, 'REFUND_FAILED', input.reason);
        throw error;
      }
      await this.recordCancellationState(input.orderId, 'LOCAL_PENDING', input.reason);
    }

    try {
      await this.applyLocalCancellation(input);
    } catch (error) {
      await this.recordCancellationState(input.orderId, 'LOCAL_FAILED', input.reason);
      throw error;
    }
    await this.settlements.cancelSettlement(input.orderId);
    return { orderId: input.orderId, status: 'CANCELLED' };
  }

  private async claimCancellation(input: {
    storeId: string;
    orderId: string;
    expectedStatus: OrderStatus;
    reason: string;
    requireOpenRound?: boolean;
  }) {
    let result = { done: false, needsRefund: false };
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${input.orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== input.storeId) {
        throw new NotFoundException();
      }
      const order = orderSnap.data() as OrderRecord;
      if (order['status'] === 'CANCELLED') {
        result = { done: true, needsRefund: false };
        return;
      }
      const cancellationStatus = order['cancellation']?.['status'] as string | undefined;
      if (!['LOCAL_PENDING', 'LOCAL_FAILED'].includes(cancellationStatus ?? '')) {
        if (order['status'] !== input.expectedStatus) {
          throw new ConflictException('주문 상태가 변경되었습니다.');
        }
        if (
          ![
            'PENDING',
            'ACCEPTED',
            'RECRUITING',
            'CONFIRMED',
            'PREPARING',
            'DELIVERY_HELD',
          ].includes(order['status'])
        ) {
          throw new ForbiddenException('취소할 수 없는 주문 상태입니다.');
        }
        if (input.requireOpenRound) await this.assertRoundOpen(tx, order, input.storeId);
        if (cancellationStatus === 'REFUNDING') {
          throw new ConflictException('주문 취소가 이미 처리 중입니다.');
        }
        const needsRefund = order['status'] !== 'PENDING';
        tx.update(orderRef, {
          cancellation: {
            status: needsRefund ? 'REFUNDING' : 'LOCAL_PENDING',
            reason: input.reason,
            updatedAt: this.toIso(this.firestore.Timestamp.now()),
          },
          updatedAt: this.firestore.Timestamp.now(),
        });
        result = { done: false, needsRefund };
      }
    });
    return result;
  }

  private async applyLocalCancellation(input: {
    storeId: string;
    orderId: string;
    reason: string;
  }) {
    const now = this.firestore.Timestamp.now();
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${input.orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== input.storeId) {
        throw new NotFoundException();
      }
      const order = orderSnap.data() as OrderRecord;
      if (order['status'] === 'CANCELLED') return;
      const cancellationStatus = order['cancellation']?.['status'];
      if (!['LOCAL_PENDING', 'LOCAL_FAILED'].includes(cancellationStatus)) {
        throw new ConflictException('주문 취소 재시도 상태가 아닙니다.');
      }
      if (order['reservationId']) {
        await this.capacity.releaseReservationInTransaction(tx, order['reservationId']);
      }
      if (order['status'] === 'DELIVERY_HELD' && order['roundId']) {
        tx.update(this.firestore.doc(`saleRounds/${order['roundId']}`), {
          'counters.heldOrderCount': this.firestore.FieldValue.increment(-1),
          updatedAt: now,
        });
      }
      tx.update(orderRef, {
        status: 'CANCELLED',
        cancelReason: input.reason,
        cancellation: {
          status: 'COMPLETED',
          reason: input.reason,
          completedAt: this.toIso(now),
          updatedAt: this.toIso(now),
        },
        updatedAt: now,
      });
    });
  }

  private async recordCancellationState(orderId: string, status: string, reason: string) {
    const now = this.firestore.Timestamp.now();
    await this.firestore.doc(`orders/${orderId}`).update({
      cancellation: { status, reason, updatedAt: this.toIso(now) },
      updatedAt: now,
    });
  }

  private async assertRoundOpen(tx: any, order: OrderRecord, storeId: string) {
    const roundSnap = await tx.get(this.firestore.doc(`saleRounds/${order['roundId']}`));
    if (!roundSnap.exists || roundSnap.data()?.['storeId'] !== storeId) {
      throw new NotFoundException('회차를 찾을 수 없습니다.');
    }
    const closeAt = new Date(roundSnap.data()?.['schedule']?.['orderCloseAt'] ?? 0).getTime();
    if (!Number.isFinite(closeAt) || closeAt <= Date.now()) {
      throw new ForbiddenException('주문 마감 후에는 직접 취소할 수 없습니다.');
    }
  }

  private buildStatusUpdate(
    order: OrderRecord,
    dto: UpdateStatusDto,
    requesterId: string,
    now: unknown,
  ) {
    const update: OrderRecord = { status: dto.status, updatedAt: now };
    if (dto.preparedAt) {
      const date = new Date(dto.preparedAt);
      if (Number.isNaN(date.getTime())) {
        throw new BadRequestException('preparedAt must be a valid ISO8601 date');
      }
      update['preparedAt'] = this.firestore.Timestamp.fromDate(date);
    }
    if (dto.status === 'DELIVERING') update['driverId'] = requesterId;
    if (['HUB_ARRIVED', 'DELIVERED'].includes(dto.status) && dto.photoUrl) {
      update['deliveryPhotoUrl'] = dto.photoUrl;
    }
    if (dto.status === 'DELIVERY_HELD') {
      const hold = dto.deliveryHold as Record<string, unknown> | undefined;
      if (!hold?.['reasonCode'] || !hold?.['reasonMessage']) {
        throw new BadRequestException('배송 보류 사유가 필요합니다.');
      }
      assertDeliveryHoldPolicy(hold);
      update['deliveryHold'] = {
        ...hold,
        heldAt: this.toIso(now),
        customerResponsible: hold['customerResponsible'] ?? false,
        redeliveryFee: hold['redeliveryFee'] ?? null,
        nextContactAt: hold['nextContactAt'] ?? null,
        nextDeliveryAt: hold['nextDeliveryAt'] ?? null,
        resolvedAt: null,
      };
    } else if (order['status'] === 'DELIVERY_HELD') {
      update['deliveryHold'] = {
        ...(order['deliveryHold'] as Record<string, unknown>),
        resolvedAt: this.toIso(now),
      };
    }
    return update;
  }

  private nextRoundCounters(raw: Record<string, number> | undefined, heldOrderDelta: number) {
    return {
      reservedDeliveryAddresses: raw?.['reservedDeliveryAddresses'] ?? 0,
      reservedItemQuantity: raw?.['reservedItemQuantity'] ?? 0,
      orderedDeliveryAddresses: raw?.['orderedDeliveryAddresses'] ?? 0,
      orderedItemQuantity: raw?.['orderedItemQuantity'] ?? 0,
      heldOrderCount: Math.max(0, (raw?.['heldOrderCount'] ?? 0) + heldOrderDelta),
    };
  }

  private toIso(value: any) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value?.toDate === 'function') return value.toDate().toISOString();
    return new Date(value).toISOString();
  }
}
