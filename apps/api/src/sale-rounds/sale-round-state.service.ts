import type { SaleRound, SaleRoundStatus } from '@greenhub/shared';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { RoundOrderLifecycleService } from '../orders/round-order-lifecycle.service';
import {
  assertCancellationClaim,
  assertManualOpenEligible,
  assertStatusTransition,
  cancellationLeaseExpiryMillis,
  isRoundOrderCancellationPending,
  resolveAutomaticState,
  SALE_ROUND_CANCELLATION_LEASE_MS,
  type SaleRoundCancellationClaim,
  type SaleRoundRecord,
  timestampIso,
  timestampMillis,
} from './sale-round-state.contract';

type CancellationClaim = SaleRoundCancellationClaim & { leaseExpiresAt: string };

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
      const now = this.firestore.Timestamp.now();
      const next = resolveAutomaticState(round, timestampMillis(now));
      if (next.status === round.status && next.closeReason === round.closeReason) {
        result = round;
        return;
      }
      const update = { ...next, updatedAt: now };
      tx.update(roundRef, update);
      result = { ...round, ...update } as unknown as SaleRound;
    });
    if (!result) throw new ConflictException('회차 상태를 확인할 수 없습니다.');
    return result;
  }

  async updateStatus(input: {
    storeId: string;
    roundId: string;
    expectedStatus?: SaleRoundStatus;
    nextStatus: SaleRoundStatus;
  }): Promise<SaleRound> {
    const roundRef = this.firestore.doc(`saleRounds/${input.roundId}`);
    let result: SaleRound | null = null;
    await this.firestore.runTransaction(async (tx: any) => {
      const snap = await tx.get(roundRef);
      const round = this.requireRound(snap, input.storeId);
      if (input.expectedStatus && round.status !== input.expectedStatus) {
        throw new ConflictException('회차 상태가 변경되었습니다.');
      }
      if (round.status === input.nextStatus) {
        result = round;
        return;
      }
      const now = this.firestore.Timestamp.now();
      assertStatusTransition(round.status, input.nextStatus);
      if (input.nextStatus === 'OPEN') {
        assertManualOpenEligible(round, timestampMillis(now));
      }
      const update = {
        status: input.nextStatus,
        closeReason: input.nextStatus === 'CLOSED' ? 'MANUAL' : null,
        updatedAt: now,
      };
      tx.update(roundRef, update);
      result = { ...round, ...update } as unknown as SaleRound;
    });
    if (!result) throw new ConflictException('회차 상태를 확인할 수 없습니다.');
    return result;
  }

  async complete(input: {
    storeId: string;
    roundId: string;
    expectedStatus?: SaleRoundStatus;
  }): Promise<SaleRound> {
    const roundRef = this.firestore.doc(`saleRounds/${input.roundId}`);
    const ordersQuery = this.firestore.collection('orders').where('roundId', '==', input.roundId);
    let result: SaleRound | null = null;
    await this.firestore.runTransaction(async (tx: any) => {
      const [roundSnap, ordersSnap] = await Promise.all([tx.get(roundRef), tx.get(ordersQuery)]);
      const round = this.requireRound(roundSnap, input.storeId);
      if (input.expectedStatus && round.status !== input.expectedStatus) {
        throw new ConflictException('회차 상태가 변경되었습니다.');
      }
      if (round.status === 'COMPLETED') {
        result = round;
        return;
      }
      assertStatusTransition(round.status, 'COMPLETED');
      const hasUnfinishedOrder = ordersSnap.docs.some((doc: any) =>
        isRoundOrderCancellationPending(doc.data()),
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
    if (!result) throw new ConflictException('회차 상태를 확인할 수 없습니다.');
    return result;
  }

  async cancel(input: {
    storeId: string;
    roundId: string;
    expectedStatus?: SaleRoundStatus;
    reason: string;
  }): Promise<SaleRound> {
    const claim = { ownerId: uuidv4(), leaseId: uuidv4() };
    const claimed = await this.claimCancellation(input, claim);
    if (claimed.done) return claimed.round;

    let currentOrderId: string | null = null;
    try {
      const orders = await this.firestore
        .collection('orders')
        .where('roundId', '==', input.roundId)
        .get();
      const activeOrders = orders.docs.filter((doc: any) =>
        isRoundOrderCancellationPending(doc.data()),
      );
      for (const order of activeOrders) {
        await this.renewCancellationLease(input.storeId, input.roundId, claim);
        currentOrderId = order.id;
        await this.roundLifecycle.cancelForRound({
          storeId: input.storeId,
          orderId: order.id,
          expectedStatus: order.data().status,
          reason: input.reason,
          cancellationClaim: claim,
        });
        await this.assertCancellationLease(input.storeId, input.roundId, claim);
      }
      await this.renewCancellationLease(input.storeId, input.roundId, claim);
      return await this.finalizeCancellation(input.storeId, input.roundId, input.reason, claim);
    } catch (error) {
      await this.recordCancellationFailure(
        input.storeId,
        input.roundId,
        input.reason,
        currentOrderId,
        claim,
      );
      throw error;
    }
  }

  private async claimCancellation(
    input: {
      storeId: string;
      roundId: string;
      expectedStatus?: SaleRoundStatus;
      reason: string;
    },
    claim: SaleRoundCancellationClaim,
  ): Promise<{ done: boolean; round: SaleRound; claim?: CancellationClaim }> {
    const roundRef = this.firestore.doc(`saleRounds/${input.roundId}`);
    let result: { done: boolean; round: SaleRound; claim?: CancellationClaim } | null = null;
    await this.firestore.runTransaction(async (tx: any) => {
      const snap = await tx.get(roundRef);
      const round = this.requireRound(snap, input.storeId);
      if (round.status === 'CANCELLED') {
        result = { done: true, round };
        return;
      }
      const cancellationStatus = round.cancellation?.status;
      if (
        input.expectedStatus &&
        round.status !== input.expectedStatus &&
        !['LOCAL_FAILED', 'CANCELLING'].includes(cancellationStatus ?? '')
      ) {
        throw new ConflictException('회차 상태가 변경되었습니다.');
      }
      assertStatusTransition(round.status, 'CANCELLED');
      const now = this.firestore.Timestamp.now();
      const nowMillis = timestampMillis(now);
      if (!Number.isFinite(nowMillis)) {
        throw new ConflictException('회차 취소 시각을 확인할 수 없습니다.');
      }
      if (
        cancellationStatus === 'CANCELLING' &&
        cancellationLeaseExpiryMillis(round.cancellation) > nowMillis
      ) {
        throw new ConflictException('회차 취소가 다른 작업자에 의해 진행 중입니다.');
      }
      const leaseExpiresAt = new Date(nowMillis + SALE_ROUND_CANCELLATION_LEASE_MS).toISOString();
      const cancellation = {
        status: 'CANCELLING' as const,
        reason: input.reason,
        failedOrderId: round.cancellation?.failedOrderId ?? null,
        ownerId: claim.ownerId,
        leaseId: claim.leaseId,
        leaseExpiresAt,
        updatedAt: timestampIso(now),
        completedAt: null,
      };
      tx.update(roundRef, { cancellation, updatedAt: now });
      result = {
        done: false,
        round: { ...round, cancellation },
        claim: { ...claim, leaseExpiresAt },
      };
    });
    if (!result) throw new ConflictException('회차 취소 상태를 확인할 수 없습니다.');
    return result;
  }

  private async recordCancellationFailure(
    storeId: string,
    roundId: string,
    reason: string,
    failedOrderId: string | null,
    claim: SaleRoundCancellationClaim,
  ) {
    await this.firestore.runTransaction(async (tx: any) => {
      const roundRef = this.firestore.doc(`saleRounds/${roundId}`);
      const snap = await tx.get(roundRef);
      const round = this.requireRound(snap, storeId);
      const now = this.firestore.Timestamp.now();
      assertCancellationClaim(round, claim, timestampMillis(now));
      tx.update(roundRef, {
        cancellation: {
          status: 'LOCAL_FAILED',
          reason,
          failedOrderId,
          ownerId: null,
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: timestampIso(now),
          completedAt: null,
        },
        updatedAt: now,
      });
    });
  }

  private async finalizeCancellation(
    storeId: string,
    roundId: string,
    reason: string,
    claim: SaleRoundCancellationClaim,
  ) {
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
      const now = this.firestore.Timestamp.now();
      assertCancellationClaim(round, claim, timestampMillis(now));
      if (round.cancellation?.status !== 'CANCELLING') {
        throw new ConflictException('회차 취소 재시도 상태가 아닙니다.');
      }
      const hasActiveOrder = ordersSnap.docs.some((doc: any) =>
        isRoundOrderCancellationPending(doc.data()),
      );
      if (hasActiveOrder) {
        throw new ConflictException('활성 주문 정리가 완료되지 않았습니다.');
      }
      const cancellation = {
        status: 'COMPLETED' as const,
        reason,
        failedOrderId: null,
        ownerId: null,
        leaseId: null,
        leaseExpiresAt: null,
        updatedAt: timestampIso(now),
        completedAt: timestampIso(now),
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
    if (!result) throw new ConflictException('회차 상태를 확인할 수 없습니다.');
    return result;
  }

  private async renewCancellationLease(
    storeId: string,
    roundId: string,
    claim: SaleRoundCancellationClaim,
  ) {
    await this.firestore.runTransaction(async (tx: any) => {
      const roundRef = this.firestore.doc(`saleRounds/${roundId}`);
      const snap = await tx.get(roundRef);
      const round = this.requireRound(snap, storeId);
      const now = this.firestore.Timestamp.now();
      const nowMillis = timestampMillis(now);
      if (!Number.isFinite(nowMillis)) {
        throw new ConflictException('회차 취소 시각을 확인할 수 없습니다.');
      }
      assertCancellationClaim(round, claim, nowMillis);
      const cancellation = {
        ...(round.cancellation ?? {}),
        leaseExpiresAt: new Date(nowMillis + SALE_ROUND_CANCELLATION_LEASE_MS).toISOString(),
        updatedAt: timestampIso(now),
      };
      tx.update(roundRef, { cancellation, updatedAt: now });
    });
  }

  private async assertCancellationLease(
    storeId: string,
    roundId: string,
    claim: SaleRoundCancellationClaim,
  ) {
    await this.firestore.runTransaction(async (tx: any) => {
      const snap = await tx.get(this.firestore.doc(`saleRounds/${roundId}`));
      const round = this.requireRound(snap, storeId);
      assertCancellationClaim(round, claim, timestampMillis(this.firestore.Timestamp.now()));
    });
  }

  private requireRound(snap: any, storeId: string): SaleRoundRecord {
    if (!snap.exists || snap.data()?.storeId !== storeId) {
      throw new NotFoundException('회차를 찾을 수 없습니다.');
    }
    return snap.data() as SaleRoundRecord;
  }
}
