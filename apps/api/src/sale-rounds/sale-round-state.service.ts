import type { SaleRound, SaleRoundCloseReason, SaleRoundStatus } from '@greenhub/shared';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { RoundOrderLifecycleService } from '../orders/round-order-lifecycle.service';

type RoundRecord = SaleRound & Record<string, any>;

@Injectable()
export class SaleRoundStateService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly roundLifecycle: RoundOrderLifecycleService,
  ) {}

  async refreshStatus(storeId: string, roundId: string): Promise<SaleRound> {
    const roundRef = this.firestore.doc(`saleRounds/${roundId}`);
    let result: SaleRound | null = null;
    await this.firestore.runTransaction(async (tx: any) => {
      const snap = await tx.get(roundRef);
      const round = this.requireRound(snap, storeId);
      const next = this.resolveAutomaticState(round);
      if (next.status === round.status && next.closeReason === round.closeReason) {
        result = round;
        return;
      }
      const update = { ...next, updatedAt: this.firestore.Timestamp.now() };
      tx.update(roundRef, update);
      result = { ...round, ...update } as unknown as SaleRound;
    });
    return result!;
  }

  async updateStatus(input: {
    storeId: string;
    roundId: string;
    expectedStatus: SaleRoundStatus;
    nextStatus: SaleRoundStatus;
  }): Promise<SaleRound> {
    const roundRef = this.firestore.doc(`saleRounds/${input.roundId}`);
    let result: SaleRound | null = null;
    await this.firestore.runTransaction(async (tx: any) => {
      const snap = await tx.get(roundRef);
      const round = this.requireRound(snap, input.storeId);
      if (round.status !== input.expectedStatus) {
        throw new ConflictException('회차 상태가 변경되었습니다.');
      }
      if (round.status === input.nextStatus) {
        result = round;
        return;
      }
      this.assertStatusTransition(round.status, input.nextStatus);
      const now = this.firestore.Timestamp.now();
      const update = {
        status: input.nextStatus,
        closeReason: input.nextStatus === 'CLOSED' ? 'MANUAL' : null,
        updatedAt: now,
      };
      tx.update(roundRef, update);
      result = { ...round, ...update } as unknown as SaleRound;
    });
    return result!;
  }

  async complete(input: {
    storeId: string;
    roundId: string;
    expectedStatus: SaleRoundStatus;
  }): Promise<SaleRound> {
    const roundRef = this.firestore.doc(`saleRounds/${input.roundId}`);
    const ordersQuery = this.firestore.collection('orders').where('roundId', '==', input.roundId);
    let result: SaleRound | null = null;
    await this.firestore.runTransaction(async (tx: any) => {
      const [roundSnap, ordersSnap] = await Promise.all([tx.get(roundRef), tx.get(ordersQuery)]);
      const round = this.requireRound(roundSnap, input.storeId);
      if (round.status !== input.expectedStatus) {
        throw new ConflictException('회차 상태가 변경되었습니다.');
      }
      if (round.status === 'COMPLETED') {
        result = round;
        return;
      }
      this.assertStatusTransition(round.status, 'COMPLETED');
      const hasUnfinishedOrder = ordersSnap.docs.some(
        (doc: any) => !['DELIVERED', 'REVIEWED', 'CANCELLED'].includes(doc.data()['status']),
      );
      if (round.counters.heldOrderCount > 0 || hasUnfinishedOrder) {
        throw new ConflictException(
          '미완료 또는 배송 보류 주문이 남아 있어 회차를 완료할 수 없습니다.',
        );
      }
      const now = this.firestore.Timestamp.now();
      const update = { status: 'COMPLETED' as const, completedAt: now, updatedAt: now };
      tx.update(roundRef, update);
      result = { ...round, ...update } as unknown as SaleRound;
    });
    return result!;
  }

  async cancel(input: {
    storeId: string;
    roundId: string;
    expectedStatus: SaleRoundStatus;
    reason: string;
  }): Promise<SaleRound> {
    const claimed = await this.claimCancellation(input);
    if (claimed.done) return claimed.round;

    const orders = await this.firestore
      .collection('orders')
      .where('roundId', '==', input.roundId)
      .get();
    const activeOrders = orders.docs.filter(
      (doc: any) => !['DELIVERED', 'REVIEWED', 'CANCELLED'].includes(doc.data()['status']),
    );
    let currentOrderId: string | null = null;
    try {
      for (const order of activeOrders) {
        currentOrderId = order.id;
        await this.roundLifecycle.cancelForRound({
          storeId: input.storeId,
          orderId: order.id,
          expectedStatus: order.data()['status'],
          reason: input.reason,
        });
      }
    } catch (error) {
      await this.recordCancellationFailure(input.roundId, input.reason, currentOrderId);
      throw error;
    }
    try {
      return await this.finalizeCancellation(input.storeId, input.roundId, input.reason);
    } catch (error) {
      await this.recordCancellationFailure(input.roundId, input.reason, null);
      throw error;
    }
  }

  private async claimCancellation(input: {
    storeId: string;
    roundId: string;
    expectedStatus: SaleRoundStatus;
    reason: string;
  }) {
    const roundRef = this.firestore.doc(`saleRounds/${input.roundId}`);
    let result!: { done: boolean; round: SaleRound };
    await this.firestore.runTransaction(async (tx: any) => {
      const snap = await tx.get(roundRef);
      const round = this.requireRound(snap, input.storeId);
      if (round.status === 'CANCELLED') {
        result = { done: true, round };
        return;
      }
      if (round.status !== input.expectedStatus && round.cancellation?.status !== 'LOCAL_FAILED') {
        throw new ConflictException('회차 상태가 변경되었습니다.');
      }
      this.assertStatusTransition(round.status, 'CANCELLED');
      if (round.cancellation?.status === 'CANCELLING') {
        throw new ConflictException('회차 취소가 이미 진행 중입니다.');
      }
      const now = this.firestore.Timestamp.now();
      const cancellation = {
        status: 'CANCELLING' as const,
        reason: input.reason,
        failedOrderId: null,
        updatedAt: this.toIso(now),
        completedAt: null,
      };
      tx.update(roundRef, { cancellation, updatedAt: now });
      result = { done: false, round: { ...round, cancellation } };
    });
    return result;
  }

  private async recordCancellationFailure(
    roundId: string,
    reason: string,
    failedOrderId: string | null,
  ) {
    const now = this.firestore.Timestamp.now();
    await this.firestore.doc(`saleRounds/${roundId}`).update({
      cancellation: {
        status: 'LOCAL_FAILED',
        reason,
        failedOrderId,
        updatedAt: this.toIso(now),
        completedAt: null,
      },
      updatedAt: now,
    });
  }

  private async finalizeCancellation(storeId: string, roundId: string, reason: string) {
    const roundRef = this.firestore.doc(`saleRounds/${roundId}`);
    const ordersQuery = this.firestore.collection('orders').where('roundId', '==', roundId);
    let result: SaleRound | null = null;
    await this.firestore.runTransaction(async (tx: any) => {
      const [snap, ordersSnap] = await Promise.all([tx.get(roundRef), tx.get(ordersQuery)]);
      const round = this.requireRound(snap, storeId);
      if (round.status === 'CANCELLED') {
        result = round;
        return;
      }
      if (round.cancellation?.status !== 'CANCELLING') {
        throw new ConflictException('회차 취소 재시도 상태가 아닙니다.');
      }
      const hasActiveOrder = ordersSnap.docs.some(
        (doc: any) => !['DELIVERED', 'REVIEWED', 'CANCELLED'].includes(doc.data()['status']),
      );
      if (hasActiveOrder) {
        throw new ConflictException('활성 주문 정리가 완료되지 않았습니다.');
      }
      const now = this.firestore.Timestamp.now();
      const cancellation = {
        status: 'COMPLETED' as const,
        reason,
        failedOrderId: null,
        updatedAt: this.toIso(now),
        completedAt: this.toIso(now),
      };
      const update = {
        status: 'CANCELLED' as const,
        closeReason: null,
        cancellation,
        cancelledAt: now,
        updatedAt: now,
      };
      tx.update(roundRef, update);
      result = { ...round, ...update } as unknown as SaleRound;
    });
    return result!;
  }

  private resolveAutomaticState(round: RoundRecord): {
    status: SaleRoundStatus;
    closeReason: SaleRoundCloseReason | null;
  } {
    const now = Date.now();
    const closeAt = new Date(round.schedule.orderCloseAt).getTime();
    const openAt = new Date(round.schedule.orderOpenAt).getTime();
    if (round.status === 'CLOSED' && round.closeReason === 'CAPACITY') {
      if (now < closeAt && !this.isCapacityFull(round)) {
        return { status: 'OPEN', closeReason: null };
      }
      return { status: 'CLOSED', closeReason: 'CAPACITY' };
    }
    if (!['SCHEDULED', 'OPEN'].includes(round.status)) {
      return { status: round.status, closeReason: round.closeReason ?? null };
    }
    if (now >= closeAt) return { status: 'CLOSED', closeReason: 'SCHEDULE_ENDED' };
    if (this.isCapacityFull(round)) return { status: 'CLOSED', closeReason: 'CAPACITY' };
    if (round.status === 'SCHEDULED' && now >= openAt) {
      return { status: 'OPEN', closeReason: null };
    }
    return { status: round.status, closeReason: round.closeReason ?? null };
  }

  private isCapacityFull(round: SaleRound) {
    const addressCount =
      round.counters.reservedDeliveryAddresses + round.counters.orderedDeliveryAddresses;
    const itemCount = round.counters.reservedItemQuantity + round.counters.orderedItemQuantity;
    return (
      addressCount >= round.limits.maxDeliveryAddresses || itemCount >= round.limits.maxItemQuantity
    );
  }

  private requireRound(snap: any, storeId: string): RoundRecord {
    if (!snap.exists || snap.data()?.['storeId'] !== storeId) {
      throw new NotFoundException('회차를 찾을 수 없습니다.');
    }
    return snap.data() as RoundRecord;
  }

  private assertStatusTransition(current: SaleRoundStatus, next: SaleRoundStatus) {
    const transitions: Record<SaleRoundStatus, SaleRoundStatus[]> = {
      DRAFT: ['SCHEDULED', 'CANCELLED'],
      SCHEDULED: ['OPEN', 'CANCELLED'],
      OPEN: ['CLOSED', 'CANCELLED'],
      CLOSED: ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    };
    if (!transitions[current].includes(next)) {
      throw new ConflictException(`${current} → ${next} 회차 상태 전환은 허용되지 않습니다.`);
    }
  }

  private toIso(value: any) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value?.toDate === 'function') return value.toDate().toISOString();
    return new Date(value).toISOString();
  }
}
