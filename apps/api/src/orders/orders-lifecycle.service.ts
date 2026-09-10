import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { SettlementsService } from '../settlements/settlements.service';
import { assertDeliveryHoldPolicy } from './delivery-hold-policy';
import type { OrderStatus, UpdateStatusDto } from './dto/update-status.dto';
import { OrderCapacityService } from './order-capacity.service';
import { DriverOrderScopeService } from './driver-order-scope.service';
import { getAllowedTransitions, NOTIFICATION_MAP } from './orders.helpers';
import {
  assertPaidRedeliveryResume,
  isCurrentRedeliveryPaymentRequired,
} from './redelivery-resume-gate';
import {
  throwDriverOrderNotFound,
  throwDriverOrderStateConflict,
} from './driver-order-error';
import { randomUUID } from 'node:crypto';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';
import { releaseLegacyDailyCapacityInTransaction } from '../payments/_lib/legacy-daily-capacity';

const LEGACY_CONSUMER_CANCEL_CLAIM_MS = 5 * 60 * 1000;

type LegacyConsumerCancelClaimResult =
  | { kind: 'done' }
  | { kind: 'in_progress' }
  | { kind: 'claimed'; token: string };

const DELIVERY_HOLD_CUSTOMER_REASONS: Record<string, string> = {
  WEATHER: '기상 상황으로 배송이 지연되었습니다.',
  ACCESS_UNAVAILABLE: '배송지 출입이 어려워 배송이 보류되었습니다.',
  ADDRESS_ISSUE: '배송지 주소를 확인할 수 없어 배송이 보류되었습니다.',
  CUSTOMER_UNREACHABLE: '수령인과 연락이 닿지 않아 배송이 보류되었습니다.',
  OTHER: '배송 진행이 어려워 배송이 보류되었습니다.',
};

@Injectable()
export class OrdersLifecycleService {
  private readonly driverScope: DriverOrderScopeService;

  constructor(
    private readonly firestore: FirestoreService,
    private readonly notifications: NotificationsService,
    private readonly payments: PaymentsService,
    private readonly settlements: SettlementsService,
    private readonly capacity: OrderCapacityService,
    private readonly roundLifecycle: RoundOrderLifecycleService,
    driverScope?: DriverOrderScopeService,
  ) {
    this.driverScope = driverScope ?? new DriverOrderScopeService(firestore);
  }

  async updateStatus(
    storeId: string,
    orderId: string,
    requesterId: string,
    dto: UpdateStatusDto,
    requesterRole?: string,
  ) {
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      if (requesterRole === 'driver') {
        throwDriverOrderNotFound();
      }
      throw new NotFoundException();
    }
    const order = snap.data()!;
    const currentStatus = order['status'] as OrderStatus;
    const nextStatus = dto.status as string;

    // JWT role을 우선 사용, 없으면 Firestore fallback
    let role = requesterRole;
    if (!role) {
      const userSnap = await this.firestore.doc(`users/${requesterId}`).get();
      role = userSnap.data()?.['role'] ?? 'consumer';
    }
    await this.assertOrderActionAccess(storeId, requesterId, role ?? 'consumer', order, nextStatus);

    const allowed = getAllowedTransitions(role ?? 'consumer', currentStatus);
    if (!allowed.includes(dto.status)) {
      if (role === 'driver') {
        throwDriverOrderStateConflict(`${currentStatus} → ${nextStatus} 전환은 허용되지 않습니다.`);
      }
      throw new ForbiddenException(`${currentStatus} → ${nextStatus} 전환은 허용되지 않습니다.`);
    }

    const notificationVariables: Record<string, string> = {};
    let confirmedCancelReason: string | null = null;
    if (nextStatus === 'CANCELLED') {
      confirmedCancelReason = this.normalizeSellerCancelReason(dto.reason);
      notificationVariables['reason'] = confirmedCancelReason;
    }
    if (nextStatus === 'DELIVERY_HELD') {
      notificationVariables['reason'] = this.resolveDeliveryHoldCustomerReason(
        dto.deliveryHold?.reasonCode,
      );
    }

    // BUG-16 T2: 셀러의 PREPARING → DELIVERED는 택배(parcel) 주문에서만 허용.
    // direct/hub 주문은 드라이버 수거(DELIVERING)를 거쳐야 하므로 셀러 임의 발송 완료 차단.
    if (
      role === 'seller' &&
      currentStatus === 'PREPARING' &&
      nextStatus === 'DELIVERED' &&
      order['deliveryMethod'] !== 'parcel'
    ) {
      throw new ForbiddenException('택배 발송 완료는 택배 주문에서만 가능합니다.');
    }

    if (order['schemaVersion'] === 2 && order['roundId']) {
      const result = await this.roundLifecycle.updateStatus({
        storeId,
        orderId,
        expectedStatus: currentStatus,
        dto: confirmedCancelReason ? { ...dto, reason: confirmedCancelReason } : dto,
        requesterId,
        requesterRole: role,
      });
      if (nextStatus === 'DELIVERED') {
        await this.reconcileDeliveryCompletion(storeId, orderId);
      } else {
        await this.sendTransitionNotification(
          order,
          currentStatus,
          nextStatus as OrderStatus,
          orderId,
          undefined,
          notificationVariables,
        );
      }
      return result;
    }

    if (nextStatus === 'CANCELLED') {
      const refundableStatuses: OrderStatus[] = [
        'ACCEPTED',
        'RECRUITING',
        'CONFIRMED',
        'PREPARING',
        'DELIVERY_HELD',
      ];
      if (refundableStatuses.includes(currentStatus)) {
        await this.payments.processRefundByOrderId(
          orderId,
          confirmedCancelReason ?? '판매자 취소',
        );
      }
      if (order['schemaVersion'] === 2 && order['reservationId']) {
        await this.capacity.releaseReservation(order['reservationId'] as string);
      }
    }

    const now = this.firestore.Timestamp.now();
    const update = this.buildStatusUpdate(
      order,
      dto,
      requesterId,
      now,
      confirmedCancelReason,
    );

    const resolvesCurrentHold =
      currentStatus === 'DELIVERY_HELD' &&
      (!isCurrentRedeliveryPaymentRequired(order) || nextStatus === 'DELIVERING');
    const heldOrderDelta = nextStatus === 'DELIVERY_HELD' ? 1 : resolvesCurrentHold ? -1 : 0;
    if (role === 'driver') {
      await this.updateDriverStatusInTransaction({
        storeId,
        orderId,
        requesterId,
        requesterRole: role,
        expectedStatus: currentStatus,
        dto,
        now,
      });
    } else if (heldOrderDelta !== 0 && order['roundId']) {
      await this.firestore.runTransaction(async (t) => {
        const orderRef = this.firestore.doc(`orders/${orderId}`);
        const latestOrderSnap = await t.get(orderRef);
        if (!latestOrderSnap.exists || latestOrderSnap.data()?.['storeId'] !== storeId) {
          throw new NotFoundException();
        }
        if (latestOrderSnap.data()?.['status'] !== currentStatus) {
          throw new ConflictException('주문 상태가 변경되었습니다.');
        }
        if (nextStatus === 'DELIVERING') {
          await assertPaidRedeliveryResume({
            tx: t,
            firestore: this.firestore,
            order: { ...latestOrderSnap.data(), id: orderId },
            orderId,
          });
        }
        const roundRef = this.firestore.doc(`saleRounds/${order['roundId']}`);
        const roundSnap = await t.get(roundRef);
        if (!roundSnap.exists || roundSnap.data()?.['storeId'] !== storeId) {
          throw new NotFoundException('회차를 찾을 수 없습니다.');
        }
        const round = roundSnap.data()!;
        const counters = this.nextRoundCounters(round['counters'], {
          heldOrderCount: heldOrderDelta,
        });
        t.update(roundRef, { counters, updatedAt: update['updatedAt'] });
        if (nextStatus === 'CANCELLED') {
          await releaseLegacyDailyCapacityInTransaction(
            this.firestore,
            t,
            orderId,
            confirmedCancelReason ?? '판매자 취소',
          );
        }
        t.update(orderRef, update);
      });
    } else {
      if (nextStatus === 'DELIVERING') {
        await this.firestore.runTransaction(async (transaction) => {
          const orderRef = this.firestore.doc(`orders/${orderId}`);
          const latestSnap = await transaction.get(orderRef);
          if (!latestSnap.exists || latestSnap.data()?.['storeId'] !== storeId) {
            throw new NotFoundException();
          }
          const latestOrder = latestSnap.data()!;
          if (latestOrder['status'] !== currentStatus) {
            throw new ConflictException('주문 상태가 변경되었습니다.');
          }
          await assertPaidRedeliveryResume({
            tx: transaction,
            firestore: this.firestore,
            order: { ...latestOrder, id: orderId },
            orderId,
          });
          transaction.update(orderRef, update);
        });
      } else {
        if (nextStatus === 'CANCELLED') {
          await this.firestore.runTransaction(async (transaction) => {
            const orderRef = this.firestore.doc(`orders/${orderId}`);
            const latestSnap = await transaction.get(orderRef);
            if (!latestSnap.exists || latestSnap.data()?.['storeId'] !== storeId) {
              throw new NotFoundException();
            }
            if (latestSnap.data()?.['status'] !== currentStatus) {
              throw new ConflictException('주문 상태가 변경되었습니다.');
            }
            await releaseLegacyDailyCapacityInTransaction(
              this.firestore,
              transaction,
              orderId,
              confirmedCancelReason ?? '판매자 취소',
            );
            transaction.update(orderRef, update);
          });
        } else {
          await this.firestore.runTransaction(async (transaction) => {
            const orderRef = this.firestore.doc(`orders/${orderId}`);
            const latestSnap = await transaction.get(orderRef);
            if (!latestSnap.exists || latestSnap.data()?.['storeId'] !== storeId) {
              throw new NotFoundException();
            }
            if (latestSnap.data()?.['status'] !== currentStatus) {
              throw new ConflictException('주문 상태가 변경되었습니다.');
            }
            transaction.update(
              orderRef,
              this.buildStatusUpdate(
                latestSnap.data()!,
                dto,
                requesterId,
                now,
                confirmedCancelReason,
              ),
            );
          });
        }
      }
    }

    // 판매자 강제 취소 → settlement 취소 반영
    if (nextStatus === 'CANCELLED') {
      await this.settlements.cancelSettlement(orderId);
    }

    // DELIVERED 전환 시 정산 자동 생성
    if (nextStatus === 'DELIVERED') {
      await this.settlements.createSettlement(order, 'DELIVERED');
    }

    // 알림 발송
    await this.sendTransitionNotification(
      order,
      currentStatus,
      nextStatus as OrderStatus,
      orderId,
      undefined,
      notificationVariables,
    );

    return { orderId, status: nextStatus };
  }

  async reconcileDeliveryCompletion(storeId: string, orderId: string) {
    const snapshot = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snapshot.exists || snapshot.data()?.['storeId'] !== storeId) {
      throw new NotFoundException();
    }
    const order = { ...snapshot.data()!, id: snapshot.data()?.['id'] ?? orderId };
    if (order['status'] !== 'DELIVERED') {
      throw new BadRequestException('배송 완료 주문만 후속효과를 재조정할 수 있습니다.');
    }

    await this.settlements.createSettlement(order, 'DELIVERED');
    await this.sendTransitionNotification(
      order,
      'DELIVERING',
      'DELIVERED',
      orderId,
      `order-transition:${orderId}:DELIVERING:DELIVERED`,
    );
    return { orderId, status: 'DELIVERED' as const };
  }

  async cancelOrder(storeId: string, orderId: string, userId: string, reason?: string) {
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException();
    }
    const order = snap.data()!;

    if (order['userId'] !== userId) throw new ForbiddenException();
    if (order['schemaVersion'] === 2 && order['roundId']) {
      return this.roundLifecycle.cancelByConsumer({ storeId, orderId, userId, reason });
    }

    // Fast stale guard preserves current 403 contract without side effects.
    // Durable ownership below revalidates fresh state inside transaction before any refund.
    if (order['status'] !== 'RECRUITING' && order['status'] !== 'CANCELLED') {
      throw new ForbiddenException('RECRUITING 상태에서만 취소 가능합니다.');
    }

    const cancelReason = reason ?? '소비자 취소';
    const productId = order['productId'] as string;

    const claim = await this.claimLegacyConsumerCancellation(
      storeId,
      orderId,
      userId,
      cancelReason,
    );
    if (claim.kind === 'done') {
      // Already CANCELLED+COMPLETED: converge settlement idempotently, never refund/quantity/notify again.
      await this.settlements.cancelSettlement(orderId);
      throw new ForbiddenException('RECRUITING 상태에서만 취소 가능합니다.');
    }
    if (claim.kind === 'in_progress') {
      throw new ConflictException('주문 취소가 이미 처리 중입니다.');
    }

    try {
      await this.payments.processRefundByOrderId(orderId, cancelReason);
    } catch (error) {
      await this.recordLegacyConsumerCancellationState(
        storeId,
        orderId,
        claim.token,
        'REFUND_FAILED',
        cancelReason,
      );
      throw error;
    }

    try {
      await this.applyLegacyConsumerLocalCancellation(
        storeId,
        orderId,
        claim.token,
        cancelReason,
      );
      await this.settlements.cancelSettlement(orderId);
    } catch (error) {
      await this.recordLegacyConsumerCancellationState(
        storeId,
        orderId,
        claim.token,
        'LOCAL_FAILED',
        cancelReason,
      );
      throw error;
    }

    try {
      await this.notifications.sendToUser(
        userId,
        'GROUP_CANCELLED_SELF',
        { orderId, productId },
        orderId,
        `consumer-cancel:${orderId}`,
      );
    } catch (error) {
      await this.recordLegacyConsumerCancellationState(
        storeId,
        orderId,
        claim.token,
        'LOCAL_FAILED',
        cancelReason,
      );
      throw error;
    }

    return { orderId, status: 'CANCELLED' };
  }

  private async claimLegacyConsumerCancellation(
    storeId: string,
    orderId: string,
    userId: string,
    reason: string,
  ): Promise<LegacyConsumerCancelClaimResult> {
    const token = randomUUID();
    let result: LegacyConsumerCancelClaimResult = { kind: 'claimed', token };

    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== storeId) {
        throw new NotFoundException();
      }
      const order = orderSnap.data() as Record<string, any>;
      if (order['userId'] !== userId) throw new ForbiddenException();
      if (order['schemaVersion'] === 2 && order['roundId']) {
        throw new ForbiddenException('RECRUITING 상태에서만 취소 가능합니다.');
      }

      const cancellation = (order['cancellation'] ?? null) as Record<string, any> | null;
      const cancellationStatus = cancellation?.['status'] as string | undefined;

      if (order['status'] === 'CANCELLED' && cancellationStatus === 'COMPLETED') {
        result = { kind: 'done' };
        return;
      }
      if (order['status'] === 'CANCELLED' && !cancellation) {
        result = { kind: 'done' };
        return;
      }

      let expiredClaim = false;
      if (cancellationStatus === 'REFUNDING') {
        const refundClaim = cancellation?.['refundClaim'] as
          | { token?: string; expiresAt?: number }
          | undefined;
        if (
          !refundClaim ||
          typeof refundClaim.token !== 'string' ||
          refundClaim.token.length === 0 ||
          typeof refundClaim.expiresAt !== 'number'
        ) {
          result = { kind: 'in_progress' };
          return;
        }
        if (refundClaim.expiresAt > Date.now()) {
          result = { kind: 'in_progress' };
          return;
        }
        expiredClaim = true;
      }

      const retryable = ['LOCAL_FAILED', 'REFUND_FAILED'].includes(cancellationStatus ?? '');
      const isRecruiting = order['status'] === 'RECRUITING';
      const isCancelledRetry =
        order['status'] === 'CANCELLED' && (retryable || expiredClaim);
      if (!isRecruiting && !isCancelledRetry) {
        throw new ForbiddenException('RECRUITING 상태에서만 취소 가능합니다.');
      }

      const now = this.firestore.Timestamp.now();
      tx.update(orderRef, {
        cancellation: {
          status: 'REFUNDING',
          reason,
          refundClaim: {
            token,
            expiresAt: Date.now() + LEGACY_CONSUMER_CANCEL_CLAIM_MS,
          },
          updatedAt: this.toIso(now),
        },
        updatedAt: now,
      });
    });

    return result;
  }

  private async applyLegacyConsumerLocalCancellation(
    storeId: string,
    orderId: string,
    token: string,
    reason: string,
  ) {
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || orderSnap.data()?.['storeId'] !== storeId) {
        throw new NotFoundException();
      }
      const order = orderSnap.data() as Record<string, any>;
      const cancellation = (order['cancellation'] ?? null) as Record<string, any> | null;
      if (
        cancellation?.['status'] !== 'REFUNDING' ||
        cancellation?.['refundClaim']?.['token'] !== token
      ) {
        throw new ConflictException('주문 취소 claim이 더 이상 유효하지 않습니다.');
      }

      const now = this.firestore.Timestamp.now();
      if (order['status'] === 'CANCELLED') {
        tx.update(orderRef, {
          cancellation: {
            status: 'COMPLETED',
            reason,
            completedAt: this.toIso(now),
            updatedAt: this.toIso(now),
          },
          updatedAt: now,
        });
        return;
      }
      if (order['status'] !== 'RECRUITING') {
        throw new ConflictException('주문 상태가 변경되었습니다.');
      }

      const quantity = order['quantity'] as unknown;
      if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException('주문 수량이 올바르지 않아 취소할 수 없습니다.');
      }
      const gcRef = this.firestore.doc(`groupProductConfig/${order['productId']}`);
      const gcSnap = await tx.get(gcRef);

      tx.update(orderRef, {
        status: 'CANCELLED',
        cancelReason: reason,
        cancellation: {
          status: 'COMPLETED',
          reason,
          completedAt: this.toIso(now),
          updatedAt: this.toIso(now),
        },
        updatedAt: now,
      });
      if (gcSnap.exists) {
        tx.update(gcRef, {
          currentQuantity: this.firestore.FieldValue.increment(-(quantity as number)),
        });
      }
    });
  }

  private async recordLegacyConsumerCancellationState(
    storeId: string,
    orderId: string,
    token: string,
    status: 'REFUND_FAILED' | 'LOCAL_FAILED',
    reason: string,
  ) {
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) return;
      if (orderSnap.data()?.['storeId'] !== storeId) return;

      const cancellation = (orderSnap.data()?.['cancellation'] ?? null) as Record<
        string,
        any
      > | null;
      const ownsClaim = cancellation?.['refundClaim']?.['token'] === token;
      const localCompletionFailed =
        status === 'LOCAL_FAILED' && cancellation?.['status'] === 'COMPLETED';
      if (!ownsClaim && !localCompletionFailed) return;

      const now = this.firestore.Timestamp.now();
      tx.update(orderRef, {
        cancellation: {
          status,
          reason,
          updatedAt: this.toIso(now),
        },
        updatedAt: now,
      });
    });
  }

  async reviewOrder(storeId: string, orderId: string, userId: string) {
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException();
    }
    const staleOrder = snap.data()!;
    if (staleOrder['userId'] !== userId) throw new ForbiddenException();
    const entryStatus = staleOrder['status'] as string;

    const reviewableStatuses = ['DELIVERED', 'PICKED_UP'];
    let alreadyReviewed = false;
    let freshOrderForSettlement: Record<string, any> | null = null;

    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const latestSnap = await tx.get(orderRef);
      if (!latestSnap.exists || latestSnap.data()?.['storeId'] !== storeId) {
        throw new NotFoundException();
      }
      const latestOrder = latestSnap.data()!;
      if (latestOrder['userId'] !== userId) throw new ForbiddenException();
      const freshStatus = latestOrder['status'] as string;
      if (freshStatus === 'REVIEWED') {
        if (entryStatus !== 'REVIEWED') {
          throw new ConflictException('주문 상태가 변경되었습니다.');
        }
        alreadyReviewed = true;
        freshOrderForSettlement = { ...latestOrder, id: orderId };
        return;
      }
      if (!reviewableStatuses.includes(freshStatus)) {
        if (freshStatus !== entryStatus) {
          throw new ConflictException('주문 상태가 변경되었습니다.');
        }
        throw new BadRequestException('DELIVERED 또는 PICKED_UP 상태에서만 리뷰 가능합니다.');
      }
      tx.update(orderRef, {
        status: 'REVIEWED',
        updatedAt: this.firestore.Timestamp.now(),
      });
      freshOrderForSettlement = { ...latestOrder, id: orderId };
    });

    const settlementOrder = { ...(freshOrderForSettlement ?? staleOrder), id: orderId };
    await this.settlements.createSettlement(settlementOrder, 'REVIEWED');
    if (alreadyReviewed) {
      throw new BadRequestException('DELIVERED 또는 PICKED_UP 상태에서만 리뷰 가능합니다.');
    }

    return { orderId, status: 'REVIEWED' };
  }

  async confirmPickup(storeId: string, orderId: string, userId: string, pickupCode: string) {
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException();
    }
    const staleOrder = snap.data()!;
    if (staleOrder['userId'] !== userId) throw new ForbiddenException();
    const entryStatus = staleOrder['status'] as string;

    let alreadyPickedUp = false;
    let freshOrderForSettlement: Record<string, any> | null = null;

    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const latestSnap = await tx.get(orderRef);
      if (!latestSnap.exists || latestSnap.data()?.['storeId'] !== storeId) {
        throw new NotFoundException();
      }
      const latestOrder = latestSnap.data()!;
      if (latestOrder['userId'] !== userId) throw new ForbiddenException();
      const freshStatus = latestOrder['status'] as string;
      if (freshStatus === 'PICKED_UP') {
        if (latestOrder['pickupCode'] !== pickupCode) {
          throw new BadRequestException('픽업 코드가 올바르지 않습니다.');
        }
        if (entryStatus !== 'PICKED_UP') {
          throw new ConflictException('주문 상태가 변경되었습니다.');
        }
        alreadyPickedUp = true;
        freshOrderForSettlement = { ...latestOrder, id: orderId };
        return;
      }
      if (freshStatus !== 'HUB_ARRIVED') {
        if (freshStatus !== entryStatus) {
          throw new ConflictException('주문 상태가 변경되었습니다.');
        }
        throw new BadRequestException('HUB_ARRIVED 상태에서만 픽업 확인 가능');
      }
      if (latestOrder['pickupCode'] !== pickupCode) {
        throw new BadRequestException('픽업 코드가 올바르지 않습니다.');
      }
      tx.update(orderRef, {
        status: 'PICKED_UP',
        updatedAt: this.firestore.Timestamp.now(),
      });
      freshOrderForSettlement = { ...latestOrder, id: orderId };
    });

    const settlementOrder = { ...(freshOrderForSettlement ?? staleOrder), id: orderId };
    await this.settlements.createSettlement(settlementOrder, 'PICKED_UP');
    if (alreadyPickedUp) {
      throw new BadRequestException('HUB_ARRIVED 상태에서만 픽업 확인 가능');
    }

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
    const staleOrder = snap.data()!;
    const entryStatus = staleOrder['status'] as string;

    let alreadyPickedUp = false;
    let freshOrderForSettlement: Record<string, any> | null = null;

    await this.firestore.runTransaction(async (tx) => {
      const storeRef = this.firestore.doc(`stores/${storeId}`);
      const latestStoreSnap = await tx.get(storeRef);
      if (!latestStoreSnap.exists || latestStoreSnap.data()?.['ownerId'] !== requesterId) {
        throw new ForbiddenException('해당 스토어에 대한 권한이 없습니다');
      }
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const latestSnap = await tx.get(orderRef);
      if (!latestSnap.exists || latestSnap.data()?.['storeId'] !== storeId) {
        throw new NotFoundException();
      }
      const latestOrder = latestSnap.data()!;
      const freshStatus = latestOrder['status'] as string;
      if (freshStatus === 'PICKED_UP') {
        if (latestOrder['pickupCode'] !== pickupCode) {
          throw new BadRequestException('픽업 코드가 올바르지 않습니다.');
        }
        if (entryStatus !== 'PICKED_UP') {
          throw new ConflictException('주문 상태가 변경되었습니다.');
        }
        alreadyPickedUp = true;
        freshOrderForSettlement = { ...latestOrder, id: orderId };
        return;
      }
      if (freshStatus !== 'HUB_ARRIVED') {
        if (freshStatus !== entryStatus) {
          throw new ConflictException('주문 상태가 변경되었습니다.');
        }
        throw new BadRequestException('HUB_ARRIVED 상태에서만 픽업 확인 가능');
      }
      if (latestOrder['pickupCode'] !== pickupCode) {
        throw new BadRequestException('픽업 코드가 올바르지 않습니다.');
      }
      tx.update(orderRef, {
        status: 'PICKED_UP',
        updatedAt: this.firestore.Timestamp.now(),
      });
      freshOrderForSettlement = { ...latestOrder, id: orderId };
    });

    const settlementOrder = { ...(freshOrderForSettlement ?? staleOrder), id: orderId };
    await this.settlements.createSettlement(settlementOrder, 'PICKED_UP');
    if (alreadyPickedUp) {
      throw new BadRequestException('HUB_ARRIVED 상태에서만 픽업 확인 가능');
    }

    return { orderId, status: 'PICKED_UP' };
  }

  // ────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────

  private async assertOrderActionAccess(
    storeId: string,
    requesterId: string,
    role: string,
    order: Record<string, unknown>,
    nextStatus: string,
  ) {
    if (role === 'admin') return;
    if (role === 'seller') {
      const storeSnap = await this.firestore.doc(`stores/${storeId}`).get();
      if (storeSnap.exists && storeSnap.data()?.['ownerId'] === requesterId) return;
      throw new ForbiddenException('해당 스토어 주문을 변경할 권한이 없습니다.');
    }
    if (role === 'driver') {
      await this.driverScope.assertMutationEligibility({
        requesterId,
        requesterRole: role,
        storeId,
        order,
        expectedStatus: String(order['status']),
        nextStatus,
      });
      return;
    }
    if (role === 'consumer' && order['userId'] === requesterId) return;
    throw new ForbiddenException('해당 주문을 변경할 권한이 없습니다.');
  }

  private async updateDriverStatusInTransaction(input: {
    storeId: string;
    orderId: string;
    requesterId: string;
    requesterRole: string;
    expectedStatus: OrderStatus;
    dto: UpdateStatusDto;
    now: unknown;
  }) {
    await this.firestore.runTransaction(async (transaction) => {
      const orderRef = this.firestore.doc(`orders/${input.orderId}`);
      const latestSnap = await transaction.get(orderRef);
      if (!latestSnap.exists || latestSnap.data()?.['storeId'] !== input.storeId) {
        throwDriverOrderNotFound();
      }
      const latestOrder = latestSnap.data()!;
      const mutationInput = {
        requesterId: input.requesterId,
        requesterRole: input.requesterRole,
        storeId: input.storeId,
        order: { ...latestOrder, id: input.orderId },
        expectedStatus: input.expectedStatus,
        nextStatus: input.dto.status,
      };
      if (latestOrder['driverId'] == null && input.dto.status === 'DELIVERING') {
        await this.driverScope.assertFirstClaimEligibilityInTransaction(transaction, mutationInput);
      } else {
        await this.driverScope.assertMutationEligibilityInTransaction(transaction, mutationInput);
      }
      if (input.dto.status === 'DELIVERING') {
        await assertPaidRedeliveryResume({
          tx: transaction,
          firestore: this.firestore,
          order: { ...latestOrder, id: input.orderId },
          orderId: input.orderId,
          requesterRole: 'driver',
        });
      }
      const currentPaymentRequired = isCurrentRedeliveryPaymentRequired(latestOrder);
      const heldOrderDelta =
        input.dto.status === 'DELIVERY_HELD'
          ? 1
          : (input.dto.status === 'DELIVERING' && currentPaymentRequired) ||
              (input.expectedStatus === 'DELIVERY_HELD' && !currentPaymentRequired)
            ? -1
            : 0;
      if (heldOrderDelta !== 0 && latestOrder['roundId']) {
        const roundRef = this.firestore.doc(`saleRounds/${latestOrder['roundId']}`);
        const roundSnap = await transaction.get(roundRef);
        if (!roundSnap.exists || roundSnap.data()?.['storeId'] !== input.storeId) {
          throwDriverOrderNotFound('회차를 찾을 수 없습니다.');
        }
        const round = roundSnap.data()!;
        transaction.update(roundRef, {
          counters: this.nextRoundCounters(
            round['counters'],
            {
              heldOrderCount: heldOrderDelta,
            },
            { driverOrder: true },
          ),
          updatedAt: input.now,
        });
      }
      transaction.update(
        orderRef,
        this.buildStatusUpdate(latestOrder, input.dto, input.requesterId, input.now),
      );
    });
  }

  private buildStatusUpdate(
    order: Record<string, any>,
    dto: UpdateStatusDto,
    requesterId: string,
    now: unknown,
    confirmedCancelReason: string | null = null,
  ): Record<string, unknown> {
    const update: Record<string, unknown> = {
      status: dto.status,
      updatedAt: now,
    };
    if (confirmedCancelReason) update['cancelReason'] = confirmedCancelReason;
    if (dto.status === 'PREPARING' && dto.preparedAt) {
      const date = new Date(dto.preparedAt);
      if (isNaN(date.getTime())) {
        throw new BadRequestException('preparedAt must be a valid ISO8601 date');
      }
      update['preparedAt'] = this.firestore.Timestamp.fromDate(date);
    }
    if (dto.status === 'DELIVERING') update['driverId'] = requesterId;
    if ((dto.status === 'HUB_ARRIVED' || dto.status === 'DELIVERED') && dto.photoUrl) {
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

  private toIso(value: unknown) {
    if (value instanceof Date) return value.toISOString();
    if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
      return (value as { toDate: () => Date }).toDate().toISOString();
    }
    return new Date(value as string | number).toISOString();
  }

  private async sendTransitionNotification(
    order: Record<string, unknown>,
    from: OrderStatus,
    to: OrderStatus,
    orderId: string,
    idempotencyKey?: string,
    extraVariables: Record<string, string> = {},
  ) {
    const isGroup = order['saleType'] === 'group';

    // 공동구매 전용 템플릿 오버라이드 (스펙: 전체 참여자 알림 필요)
    const GROUP_TEMPLATE_OVERRIDES: Partial<
      Record<OrderStatus, Partial<Record<OrderStatus, string>>>
    > = {
      PREPARING: { DELIVERING: 'GROUP_DELIVERING' },
      DELIVERING: { DELIVERED: 'GROUP_DELIVERED' },
    };

    if (
      from === 'DELIVERY_HELD' &&
      to === 'PREPARING' &&
      !isCurrentRedeliveryPaymentRequired(order)
    ) {
      return;
    }

    const isRedeliveryResume =
      to === 'DELIVERING' &&
      (from === 'DELIVERY_HELD' ||
        (from === 'PREPARING' && isCurrentRedeliveryPaymentRequired(order)));
    const templateCode: string | null =
      isRedeliveryResume
        ? 'ORDER_REDELIVERY_SCHEDULED'
        : (isGroup ? GROUP_TEMPLATE_OVERRIDES[from]?.[to] : null) ??
          NOTIFICATION_MAP[from]?.[to] ??
          (to === 'CANCELLED' ? 'ORDER_CANCELLED' : null);

    if (!templateCode) return;

    const variables: Record<string, string> = { orderId, ...extraVariables };
    if (templateCode === 'ORDER_HUB_ARRIVED') {
      variables['productName'] = String(order['productName'] ?? '');
      variables['pickupCode'] = String(order['pickupCode'] ?? '');
      variables['hubAddress'] = String(order['hubAddress'] ?? '');
    }
    const GROUP_TEMPLATES = [
      'GROUP_PREPARING',
      'GROUP_DELIVERING',
      'GROUP_DELIVERED',
      'GROUP_CONFIRMED',
    ];

    if (isGroup && GROUP_TEMPLATES.includes(templateCode)) {
      variables['productName'] = String(order['productName'] ?? '');
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
        idempotencyKey,
      );
    }
  }

  private resolveDeliveryHoldCustomerReason(reasonCode: unknown): string {
    if (
      typeof reasonCode !== 'string' ||
      !DELIVERY_HOLD_CUSTOMER_REASONS[reasonCode]
    ) {
      throw new BadRequestException('올바른 배송 보류 사유 코드가 필요합니다.');
    }
    return DELIVERY_HOLD_CUSTOMER_REASONS[reasonCode];
  }

  private normalizeSellerCancelReason(reason: unknown): string {
    if (reason === undefined || reason === null || String(reason).trim().length === 0) {
      return '판매자 취소';
    }
    if (typeof reason !== 'string') {
      throw new BadRequestException('취소 사유는 문자열이어야 합니다.');
    }
    const normalized = reason.trim();
    if (normalized.length > 100) {
      throw new BadRequestException('취소 사유는 100자 이하여야 합니다.');
    }
    if (
      Array.from(normalized).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      })
    ) {
      throw new BadRequestException('취소 사유에는 줄바꿈이나 제어문자를 사용할 수 없습니다.');
    }
    if (
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(normalized) ||
      /(?:01[016789])[\s-]?\d{3,4}[\s-]?\d{4}/.test(normalized)
    ) {
      throw new BadRequestException('취소 사유에는 이메일이나 전화번호를 포함할 수 없습니다.');
    }
    return normalized;
  }

  private nextRoundCounters(
    raw: Record<string, number> | null | undefined,
    delta: Record<string, number>,
    options?: { driverOrder?: boolean },
  ) {
    const current = {
      reservedDeliveryAddresses: raw?.['reservedDeliveryAddresses'] ?? 0,
      reservedItemQuantity: raw?.['reservedItemQuantity'] ?? 0,
      orderedDeliveryAddresses: raw?.['orderedDeliveryAddresses'] ?? 0,
      orderedItemQuantity: raw?.['orderedItemQuantity'] ?? 0,
      heldOrderCount: raw?.['heldOrderCount'] ?? 0,
    };
    const heldOrderCount = current['heldOrderCount'];
    if ((delta['heldOrderCount'] ?? 0) < 0 && heldOrderCount < 1) {
      if (options?.driverOrder === true) {
        throwDriverOrderStateConflict('회차 보류 주문 수가 이미 정리되었습니다.', true);
      }
      throw new ConflictException('회차 보류 주문 수가 이미 정리되었습니다.');
    }
    return Object.fromEntries(
      Object.entries(current).map(([key, value]) => [key, Math.max(0, value + (delta[key] ?? 0))]),
    );
  }
}
