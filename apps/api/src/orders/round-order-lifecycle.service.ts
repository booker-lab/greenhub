import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  assertCancellationClaim,
  timestampMillis,
  type SaleRoundCancellationClaim,
  type SaleRoundRecord,
} from '../sale-rounds/sale-round-state.contract';
import { FirestoreService } from '../firestore/firestore.service';
import { PaymentsService } from '../payments/payments.service';
import { SettlementsService } from '../settlements/settlements.service';
import { assertDeliveryHoldPolicy } from './delivery-hold-policy';
import type { OrderStatus, UpdateStatusDto } from './dto/update-status.dto';
import { OrderCapacityService } from './order-capacity.service';
import { DriverOrderScopeService } from './driver-order-scope.service';
import {
  assertPaidRedeliveryResume,
  isCurrentRedeliveryPaymentRequired,
} from './redelivery-resume-gate';

type OrderRecord = Record<string, any>;

@Injectable()
export class RoundOrderLifecycleService {
  private readonly driverScope: DriverOrderScopeService;

  constructor(
    private readonly firestore: FirestoreService,
    private readonly payments: PaymentsService,
    private readonly settlements: SettlementsService,
    private readonly capacity: OrderCapacityService,
    driverScope?: DriverOrderScopeService,
  ) {
    this.driverScope = driverScope ?? new DriverOrderScopeService(firestore);
  }

  async updateStatus(input: {
    storeId: string;
    orderId: string;
    expectedStatus: OrderStatus;
    dto: UpdateStatusDto;
    requesterId: string;
    requesterRole?: string;
  }) {
    if (input.dto.status === 'CANCELLED') {
      return this.cancel({
        storeId: input.storeId,
        orderId: input.orderId,
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
      if (input.requesterRole === 'driver') {
        const mutationInput = {
          requesterId: input.requesterId,
          requesterRole: input.requesterRole,
          storeId: input.storeId,
          order: { ...order, id: input.orderId },
          expectedStatus: input.expectedStatus,
          nextStatus: input.dto.status,
        };
        if (order['driverId'] == null && input.dto.status === 'DELIVERING') {
          await this.driverScope.assertFirstClaimEligibilityInTransaction(tx, mutationInput);
        } else {
          await this.driverScope.assertMutationEligibilityInTransaction(tx, mutationInput);
        }
      }
      if (input.dto.status === 'DELIVERING') {
        await assertPaidRedeliveryResume({
          tx,
          firestore: this.firestore,
          order: { ...order, id: input.orderId },
          orderId: input.orderId,
        });
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
      const currentPaymentRequired = isCurrentRedeliveryPaymentRequired(order);
      const heldOrderDelta =
        input.dto.status === 'DELIVERY_HELD'
          ? 1
          : (input.dto.status === 'DELIVERING' && currentPaymentRequired) ||
              (input.expectedStatus === 'DELIVERY_HELD' && !currentPaymentRequired)
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
      reason: input.reason ?? '소비자 취소',
      requireOpenRound: true,
    });
  }

  async cancelForRound(input: {
    storeId: string;
    orderId: string;
    expectedStatus: OrderStatus;
    reason: string;
    cancellationClaim?: SaleRoundCancellationClaim;
  }) {
    return this.cancel({
      storeId: input.storeId,
      orderId: input.orderId,
      reason: input.reason,
      cancellationClaim: input.cancellationClaim,
    });
  }

  private async cancel(input: {
    storeId: string;
    orderId: string;
    reason: string;
    requireOpenRound?: boolean;
    cancellationClaim?: SaleRoundCancellationClaim;
  }) {
    const claimed = await this.claimCancellation(input);
    if (claimed.done) return { orderId: input.orderId, status: 'CANCELLED' };

    if (claimed.needsRefund) {
      await this.processCancellationRefund(input);
    }

    let localCancellation: { completed: boolean; needsRefund: boolean };
    try {
      localCancellation = await this.applyLocalCancellation(input);
    } catch (error) {
      await this.recordCancellationState(input, 'LOCAL_FAILED');
      throw error;
    }
    if (localCancellation.needsRefund) {
      await this.processCancellationRefund(input);
      try {
        localCancellation = await this.applyLocalCancellation(input);
      } catch (error) {
        await this.recordCancellationState(input, 'LOCAL_FAILED');
        throw error;
      }
    }
    if (!localCancellation.completed) {
      throw new ConflictException('환불 처리 결과를 확인할 수 없어 주문 취소를 완료하지 못했습니다.');
    }

    try {
      if (input.cancellationClaim) {
        await this.assertRoundCancellationClaim(input.orderId, input.cancellationClaim);
      }
      await this.settlements.cancelSettlement(input.orderId);
    } catch (error) {
      await this.recordCancellationState(input, 'LOCAL_FAILED');
      throw error;
    }
    return { orderId: input.orderId, status: 'CANCELLED' };
  }

  private async claimCancellation(input: {
    storeId: string;
    orderId: string;
    reason: string;
    requireOpenRound?: boolean;
    cancellationClaim?: SaleRoundCancellationClaim;
  }) {
    let result = { done: false, needsRefund: false };
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${input.orderId}`);
      const paymentRef = this.firestore.doc(`payments/${input.orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== input.storeId) {
        throw new NotFoundException();
      }
      const order = orderSnap.data() as OrderRecord;
      const paymentSnap = await tx.get(paymentRef);
      const payment = paymentSnap.exists ? (paymentSnap.data() as OrderRecord) : null;
      const paymentIsPaid = payment?.['status'] === 'PAID' && !payment['refundedAt'];
      if (input.cancellationClaim) {
        await this.assertRoundCancellationClaimInTransaction(tx, order, input.cancellationClaim);
      }
      if (order['status'] === 'CANCELLED') {
        result = {
          done: order['cancellation']?.['status'] === 'COMPLETED' && !paymentIsPaid,
          needsRefund: paymentIsPaid,
        };
        return;
      }
      const cancellationStatus = order['cancellation']?.['status'] as string | undefined;
      if (cancellationStatus === 'REFUNDING') {
        result = { done: false, needsRefund: paymentIsPaid };
        return;
      }
      if (!['LOCAL_PENDING', 'LOCAL_FAILED'].includes(cancellationStatus ?? '')) {
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
        const needsRefund = order['status'] !== 'PENDING' || paymentIsPaid;
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
    cancellationClaim?: SaleRoundCancellationClaim;
  }) {
    const now = this.firestore.Timestamp.now();
    let result = { completed: false, needsRefund: false };
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${input.orderId}`);
      const paymentRef = this.firestore.doc(`payments/${input.orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== input.storeId) {
        throw new NotFoundException();
      }
      const order = orderSnap.data() as OrderRecord;
      const paymentSnap = await tx.get(paymentRef);
      const payment = paymentSnap.exists ? (paymentSnap.data() as OrderRecord) : null;
      const paymentIsPaid = payment?.['status'] === 'PAID' && !payment['refundedAt'];
      if (input.cancellationClaim) {
        await this.assertRoundCancellationClaimInTransaction(tx, order, input.cancellationClaim);
      }
      if (order['status'] === 'CANCELLED') {
        if (paymentIsPaid) {
          tx.update(orderRef, {
            cancellation: {
              status: 'REFUNDING',
              reason: input.reason,
              updatedAt: this.toIso(now),
            },
            updatedAt: now,
          });
          result = { completed: false, needsRefund: true };
          return;
        }
        if (order['cancellation']?.['status'] !== 'COMPLETED') {
          tx.update(orderRef, {
            cancellation: {
              status: 'COMPLETED',
              reason: input.reason,
              completedAt: this.toIso(now),
              updatedAt: this.toIso(now),
            },
            updatedAt: now,
          });
        }
        result = { completed: true, needsRefund: false };
        return;
      }
      const cancellationStatus = order['cancellation']?.['status'];
      if (!['LOCAL_PENDING', 'LOCAL_FAILED'].includes(cancellationStatus)) {
        throw new ConflictException('주문 취소 재시도 상태가 아닙니다.');
      }
      if (paymentIsPaid) {
        tx.update(orderRef, {
          cancellation: {
            status: 'REFUNDING',
            reason: input.reason,
            updatedAt: this.toIso(now),
          },
          updatedAt: now,
        });
        result = { completed: false, needsRefund: true };
        return;
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
      result = { completed: true, needsRefund: false };
    });
    return result;
  }

  private async processCancellationRefund(input: {
    storeId: string;
    orderId: string;
    reason: string;
    cancellationClaim?: SaleRoundCancellationClaim;
  }) {
    try {
      await this.payments.processRefundByOrderId(input.orderId, input.reason);
      await this.payments.refundOrderChargesByOrderId(input.orderId, input.reason);
    } catch (error) {
      await this.recordCancellationState(input, 'REFUND_FAILED');
      throw error;
    }
    await this.recordCancellationState(input, 'LOCAL_PENDING');
  }

  private async recordCancellationState(
    input: {
      storeId: string;
      orderId: string;
      reason: string;
      cancellationClaim?: SaleRoundCancellationClaim;
    },
    status: string,
  ) {
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${input.orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== input.storeId) {
        throw new NotFoundException();
      }
      const order = orderSnap.data() as OrderRecord;
      if (input.cancellationClaim) {
        await this.assertRoundCancellationClaimInTransaction(tx, order, input.cancellationClaim);
      }
      const now = this.firestore.Timestamp.now();
      tx.update(orderRef, {
        cancellation: { status, reason: input.reason, updatedAt: this.toIso(now) },
        updatedAt: now,
      });
    });
  }

  private async assertRoundCancellationClaim(
    orderId: string,
    claim: SaleRoundCancellationClaim,
  ) {
    await this.firestore.runTransaction(async (tx) => {
      const orderSnap = await tx.get(this.firestore.doc(`orders/${orderId}`));
      if (!orderSnap.exists) throw new NotFoundException();
      await this.assertRoundCancellationClaimInTransaction(
        tx,
        orderSnap.data() as OrderRecord,
        claim,
      );
    });
  }

  private async assertRoundCancellationClaimInTransaction(
    tx: any,
    order: OrderRecord,
    claim: SaleRoundCancellationClaim,
  ) {
    const roundId = order['roundId'];
    if (!roundId) {
      throw new ConflictException('회차 주문의 취소 소유권을 확인할 수 없습니다.');
    }
    const roundSnap = await tx.get(this.firestore.doc(`saleRounds/${roundId}`));
    if (!roundSnap.exists || roundSnap.data()?.['storeId'] !== order['storeId']) {
      throw new NotFoundException('회차를 찾을 수 없습니다.');
    }
    assertCancellationClaim(
      roundSnap.data() as SaleRoundRecord,
      claim,
      timestampMillis(this.firestore.Timestamp.now()),
    );
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
    } else if (
      (dto.status === 'DELIVERING' && isCurrentRedeliveryPaymentRequired(order)) ||
      (order['status'] === 'DELIVERY_HELD' && !isCurrentRedeliveryPaymentRequired(order))
    ) {
      update['deliveryHold'] = {
        ...(order['deliveryHold'] as Record<string, unknown>),
        resolvedAt: this.toIso(now),
      };
    }
    return update;
  }

  private nextRoundCounters(raw: Record<string, number> | undefined, heldOrderDelta: number) {
    const heldOrderCount = raw?.['heldOrderCount'] ?? 0;
    if (heldOrderDelta < 0 && heldOrderCount < 1) {
      throw new ConflictException('회차 보류 주문 수가 이미 정리되었습니다.');
    }
    return {
      reservedDeliveryAddresses: raw?.['reservedDeliveryAddresses'] ?? 0,
      reservedItemQuantity: raw?.['reservedItemQuantity'] ?? 0,
      orderedDeliveryAddresses: raw?.['orderedDeliveryAddresses'] ?? 0,
      orderedItemQuantity: raw?.['orderedItemQuantity'] ?? 0,
      heldOrderCount: heldOrderCount + heldOrderDelta,
    };
  }

  private toIso(value: any) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value?.toDate === 'function') return value.toDate().toISOString();
    return new Date(value).toISOString();
  }
}
