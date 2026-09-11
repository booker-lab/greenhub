import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { FirestoreService } from '../firestore/firestore.service';
import {
  assertOrderWindowOpen,
  type SaleRoundRecord,
  timestampMillis,
} from '../sale-rounds/sale-round-state.contract';
import {
  throwDriverOrderNotFound,
  throwDriverOrderStateConflict,
} from './driver-order-error';

// Late-payment reacquisition failed in a way that must converge to the current
// late-payment refund policy without leaving an orphan reservation.
// Thrown only by reacquireAndConsumeLatePaymentInTransaction for fresh
// reacquisition validation failures (missing round/item, window/city,
// upper-bound capacity). Defensive idempotency mismatches (different
// orderId/paymentId reuse) throw generic ConflictException instead so they
// surface as bugs rather than silent refunds.
export class LatePaymentCapacityError extends ConflictException {
  constructor(message = '결제 만료 후 회차 한도 마감') {
    super(message);
  }
}

type RoundItemInput = {
  roundItemId: string;
  quantity: number;
};

type DeliveryAddressInput = {
  address: string;
  addressDetail?: string | null;
  zipCode?: string | null;
};

type CapacityCounters = {
  reservedDeliveryAddresses: number;
  reservedItemQuantity: number;
  orderedDeliveryAddresses: number;
  orderedItemQuantity: number;
  heldOrderCount: number;
};

type ReservationStatus = 'HELD' | 'CONSUMED' | 'RELEASED' | 'EXPIRED';

type ReservationRecord = {
  id: string;
  roundId: string;
  storeId: string;
  userId: string;
  orderId: string | null;
  paymentId: string | null;
  status: ReservationStatus;
  addressKey: string;
  deliveryAddressCount: 1;
  itemQuantityTotal: number;
  items: Array<{
    roundItemId: string;
    productId: string;
    productName: string;
    productImageUrl: string | null;
    quantity: number;
    unitPrice: number;
  }>;
  idempotencyKey: string;
  expiresAt: string;
  consumedAt: string | null;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class OrderCapacityService {
  constructor(private readonly firestore: FirestoreService) {}

  async reserveCheckout(input: {
    storeId: string;
    roundId: string;
    userId: string;
    idempotencyKey: string;
    deliveryAddress: DeliveryAddressInput;
    items: RoundItemInput[];
  }): Promise<ReservationRecord> {
    const reservationId = this.reservationId(input.storeId, input.roundId, input.idempotencyKey);
    const reservationRef = this.firestore.doc(`checkoutReservations/${reservationId}`);
    let result: ReservationRecord | null = null;

    await this.firestore.runTransaction(async (tx: any) => {
      result = await this.reserveCheckoutInTransaction(tx, input);
    });

    return result!;
  }

  async reserveCheckoutInTransaction(
    tx: any,
    input: {
      storeId: string;
      roundId: string;
      userId: string;
      idempotencyKey: string;
      deliveryAddress: DeliveryAddressInput;
      items: RoundItemInput[];
    },
  ): Promise<ReservationRecord> {
    const reservationId = this.reservationId(input.storeId, input.roundId, input.idempotencyKey);
    const reservationRef = this.firestore.doc(`checkoutReservations/${reservationId}`);
    const reservationSnap = await tx.get(reservationRef);
    if (reservationSnap.exists) return reservationSnap.data() as ReservationRecord;

    const roundRef = this.firestore.doc(`saleRounds/${input.roundId}`);
    const roundSnap = await tx.get(roundRef);
    if (!roundSnap.exists || roundSnap.data()?.['storeId'] !== input.storeId) {
      throw new NotFoundException('회차를 찾을 수 없습니다.');
    }
    const round = roundSnap.data() as Record<string, any>;
    const now = this.firestore.Timestamp.now();
    this.assertRoundReservable(round, timestampMillis(now));
    this.assertDeliveryCity(input.deliveryAddress.address, round['deliveryRegion']?.['city']);

    const normalizedItems = this.normalizeItems(input.items);
    const itemSnaps = await Promise.all(
      normalizedItems.map((item) =>
        tx.get(this.firestore.doc(`saleRoundItems/${item.roundItemId}`)),
      ),
    );
    const itemRecords = itemSnaps.map((snap, index) => {
      if (!snap.exists) throw new NotFoundException('회차 상품을 찾을 수 없습니다.');
      const item = snap.data() as Record<string, any>;
      if (item['roundId'] !== input.roundId || item['storeId'] !== input.storeId) {
        throw new NotFoundException('회차 상품을 찾을 수 없습니다.');
      }
      if (item['status'] !== 'ACTIVE') {
        throw new ConflictException('구매할 수 없는 회차 상품입니다.');
      }
      return { input: normalizedItems[index], data: item };
    });

    const totalQuantity = normalizedItems.reduce((sum, item) => sum + item.quantity, 0);
    this.assertRoundCapacity(round, totalQuantity);
    itemRecords.forEach((item) => {
      this.assertItemCapacity(item.data, item.input.quantity);
    });

    const nowMillis = timestampMillis(now);
    if (!Number.isFinite(nowMillis)) {
      throw new ConflictException('예약 시각을 확인할 수 없습니다.');
    }
    const nowIso = this.toDate(now).toISOString();
    const reservation: ReservationRecord = {
      id: reservationId,
      roundId: input.roundId,
      storeId: input.storeId,
      userId: input.userId,
      orderId: null,
      paymentId: null,
      status: 'HELD',
      addressKey: this.addressKey(input.deliveryAddress),
      deliveryAddressCount: 1,
      itemQuantityTotal: totalQuantity,
      items: itemRecords.map((item) => ({
        roundItemId: item.input.roundItemId,
        productId: item.data['productId'],
        productName: item.data['productNameSnapshot'],
        productImageUrl: item.data['productImageUrlSnapshot'] ?? null,
        quantity: item.input.quantity,
        unitPrice: item.data['roundPrice'],
      })),
      idempotencyKey: input.idempotencyKey,
      expiresAt: new Date(nowMillis + 15 * 60_000).toISOString(),
      consumedAt: null,
      releasedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    // Fail-closed validation before any write (upper bounds already checked;
    // lower-bound helper also validates current counters are finite).
    const nextReserveCounters = this.nextCountersOrThrow(round['counters'], {
      reservedDeliveryAddresses: 1,
      reservedItemQuantity: totalQuantity,
    });
    itemRecords.forEach((item) => {
      this.assertFiniteCounter(item.data['reservedQuantity'], 'item');
      this.assertFiniteCounter(item.data['orderedQuantity'], 'item');
    });

    tx.set(reservationRef, reservation);
    tx.update(roundRef, {
      counters: nextReserveCounters,
      updatedAt: nowIso,
    });
    itemRecords.forEach((item) => {
      tx.update(this.firestore.doc(`saleRoundItems/${item.input.roundItemId}`), {
        reservedQuantity:
          this.assertFiniteCounter(item.data['reservedQuantity'], 'item') + item.input.quantity,
        updatedAt: nowIso,
      });
    });
    return reservation;
  }

  async consumeReservation(input: {
    reservationId: string;
    orderId: string;
    paymentId?: string | null;
  }): Promise<ReservationRecord> {
    return this.moveReservation(input.reservationId, 'CONSUMED', {
      orderId: input.orderId,
      paymentId: input.paymentId ?? null,
    });
  }

  async consumeReservationInTransaction(
    tx: any,
    input: { reservationId: string; orderId: string; paymentId?: string | null },
  ): Promise<ReservationRecord> {
    return this.moveReservationInTransaction(tx, input.reservationId, 'CONSUMED', {
      orderId: input.orderId,
      paymentId: input.paymentId ?? null,
    });
  }

  async releaseReservationInTransaction(
    tx: any,
    reservationId: string,
    status: Extract<ReservationStatus, 'RELEASED' | 'EXPIRED'> = 'RELEASED',
  ): Promise<ReservationRecord> {
    return this.moveReservationInTransaction(tx, reservationId, status, {});
  }

  async releaseReservation(
    reservationId: string,
    status: Extract<ReservationStatus, 'RELEASED' | 'EXPIRED'> = 'RELEASED',
  ): Promise<ReservationRecord> {
    return this.moveReservation(reservationId, status, {});
  }

  /**
   * Single-owner held-order counter primitive (InTransaction).
   * All saleRounds.counters.heldOrderCount mutations must go through here.
   * Reads the round before any write; fail-closed on missing round/store
   * mismatch and on lower-bound underflow (no clamp).
   */
  async adjustHeldOrderCountInTransaction(
    tx: any,
    input: {
      storeId: string;
      roundId: string;
      delta: number;
      now?: unknown;
      driverOrder?: boolean;
    },
  ): Promise<CapacityCounters> {
    const roundRef = this.firestore.doc(`saleRounds/${input.roundId}`);
    const roundSnap = await tx.get(roundRef);
    if (!roundSnap.exists || roundSnap.data()?.['storeId'] !== input.storeId) {
      if (input.driverOrder === true) {
        throwDriverOrderNotFound('회차를 찾을 수 없습니다.');
      }
      throw new NotFoundException('회차를 찾을 수 없습니다.');
    }
    const round = roundSnap.data() as Record<string, any>;
    let next: CapacityCounters;
    try {
      next = this.nextCountersOrThrow(round['counters'], {
        heldOrderCount: input.delta,
      });
    } catch (error) {
      if (input.delta < 0 && input.driverOrder === true) {
        throwDriverOrderStateConflict('회차 보류 주문 수가 이미 정리되었습니다.', true);
      }
      throw error;
    }
    // Preserve the existing driver envelope for held underflow even when the
    // helper throws a generic Conflict (e.g. corrupt counter type).
    if (input.delta < 0) {
      const current = this.countersStrict(round['counters'], 'round');
      void current;
    }
    const nowIso = input.now ? this.toDate(input.now).toISOString() : this.toDate(this.firestore.Timestamp.now()).toISOString();
    tx.update(roundRef, { counters: next, updatedAt: nowIso });
    return next;
  }

  /**
   * Cancellation-combined release + held primitive.
   * Performs reservation release and optional held decrement in ONE transaction
   * with a single read phase (reservation + round + items) followed by a single
   * write phase, so no read-after-write occurs. Used by DELIVERY_HELD
   * cancellation where ordered projection and held projection must each move
   * exactly once.
   */
  async releaseForOrderCancellationInTransaction(
    tx: any,
    input: {
      reservationId?: string | null;
      storeId: string;
      roundId?: string | null;
      decrementHeld: boolean;
      now?: unknown;
      driverOrder?: boolean;
    },
  ): Promise<{ reservation: ReservationRecord | null; counters: CapacityCounters | null }> {
    const nowIso = input.now
      ? this.toDate(input.now).toISOString()
      : this.toDate(this.firestore.Timestamp.now()).toISOString();

    if (!input.reservationId) {
      if (!input.decrementHeld) return { reservation: null, counters: null };
      if (!input.roundId) throw new NotFoundException('회차를 찾을 수 없습니다.');
      const counters = await this.adjustHeldOrderCountInTransaction(tx, {
        storeId: input.storeId,
        roundId: input.roundId,
        delta: -1,
        now: nowIso,
        driverOrder: input.driverOrder,
      });
      return { reservation: null, counters };
    }

    // Read phase: reservation + round + items before any write.
    const reservationRef = this.firestore.doc(`checkoutReservations/${input.reservationId}`);
    const reservationSnap = await tx.get(reservationRef);
    if (!reservationSnap.exists) throw new NotFoundException('결제 예약을 찾을 수 없습니다.');
    const reservation = reservationSnap.data() as ReservationRecord;

    // Idempotent convergence: already release-terminal => no counter move.
    // Held handling is decided by the caller order state, not by reservation
    // retry alone; if the order already flipped to CANCELLED the caller
    // returns before calling here. If we are here with an already-released
    // reservation but decrementHeld requested, the held guard below still
    // applies fail-closed (corrupt zero => throw).
    const isReleaseTerminal =
      reservation.status === 'RELEASED' || reservation.status === 'EXPIRED';
    const roundId = reservation.roundId;
    if (input.roundId && input.roundId !== roundId) {
      throw new NotFoundException('회차를 찾을 수 없습니다.');
    }
    if (reservation.storeId !== input.storeId) {
      throw new NotFoundException('회차를 찾을 수 없습니다.');
    }
    const roundRef = this.firestore.doc(`saleRounds/${roundId}`);
    const roundSnap = await tx.get(roundRef);
    if (!roundSnap.exists || roundSnap.data()?.['storeId'] !== reservation.storeId) {
      if (input.driverOrder === true) throwDriverOrderNotFound('회차를 찾을 수 없습니다.');
      throw new NotFoundException('회차를 찾을 수 없습니다.');
    }
    const round = roundSnap.data() as Record<string, any>;
    const itemSnaps = await Promise.all(
      reservation.items.map((item) =>
        tx.get(this.firestore.doc(`saleRoundItems/${item.roundItemId}`)),
      ),
    );
    const itemRecords = itemSnaps.map((snap, index) => {
      if (!snap.exists) throw new NotFoundException('회차 상품을 찾을 수 없습니다.');
      const data = snap.data() as Record<string, any> | undefined;
      if (!data) throw new NotFoundException('회차 상품을 찾을 수 없습니다.');
      if (data['roundId'] !== reservation.roundId || data['storeId'] !== reservation.storeId) {
        throw new NotFoundException('회차 상품을 찾을 수 없습니다.');
      }
      return { expected: reservation.items[index], data };
    });

    // If reservation already release-terminal, do not move reservation/item/
    // ordered counters again. Held (if requested) is still evaluated
    // fail-closed against the same round snapshot (no extra read).
    if (isReleaseTerminal) {
      if (!input.decrementHeld) return { reservation, counters: null };
      let next: CapacityCounters;
      try {
        next = this.nextCountersOrThrow(round['counters'], { heldOrderCount: -1 });
      } catch (error) {
        if (input.driverOrder === true) {
          throwDriverOrderStateConflict('회차 보류 주문 수가 이미 정리되었습니다.', true);
        }
        throw error;
      }
      tx.update(roundRef, { counters: next, updatedAt: nowIso });
      return { reservation, counters: next };
    }

    // Only CONSUMED->RELEASED and HELD->RELEASED are valid cancellation
    // releases. HELD->EXPIRED and CONSUMED->EXPIRED are not cancellation
    // paths and stay fail-closed here.
    const validRelease =
      (reservation.status === 'CONSUMED' || reservation.status === 'HELD');
    if (!validRelease) {
      throw new ConflictException('이미 닫힌 결제 예약입니다.');
    }
    const wasConsumed = reservation.status === 'CONSUMED';
    const roundDelta: Partial<CapacityCounters> = {
      reservedDeliveryAddresses: wasConsumed ? 0 : -1,
      reservedItemQuantity: wasConsumed ? 0 : -reservation.itemQuantityTotal,
      orderedDeliveryAddresses: wasConsumed ? -1 : 0,
      orderedItemQuantity: wasConsumed ? -reservation.itemQuantityTotal : 0,
    };
    if (input.decrementHeld) {
      roundDelta.heldOrderCount = -1;
    }
    let nextCounters: CapacityCounters;
    try {
      nextCounters = this.nextCountersOrThrow(round['counters'], roundDelta);
    } catch (error) {
      if ((roundDelta.heldOrderCount ?? 0) < 0 && input.driverOrder === true) {
        const currentHeld = (round['counters'] as Record<string, unknown> | undefined)?.[
          'heldOrderCount'
        ];
        if (typeof currentHeld !== 'number' || currentHeld < 1) {
          throwDriverOrderStateConflict('회차 보류 주문 수가 이미 정리되었습니다.', true);
        }
      }
      throw error;
    }
    const nextItemCounters = itemRecords.map(({ expected, data }) => {
      const reserved = this.assertFiniteCounter(data['reservedQuantity'], 'item');
      const ordered = this.assertFiniteCounter(data['orderedQuantity'], 'item');
      const nextReserved = wasConsumed ? reserved : reserved - expected.quantity;
      const nextOrdered = wasConsumed ? ordered - expected.quantity : ordered;
      if (nextReserved < 0 || nextOrdered < 0) {
        throw new ConflictException('회차 상품 수량 상태가 올바르지 않아 처리할 수 없습니다.');
      }
      return { nextReserved, nextOrdered };
    });

    // Write phase only.
    const update: Partial<ReservationRecord> = {
      status: 'RELEASED',
      updatedAt: nowIso,
      releasedAt: nowIso,
    };
    tx.update(reservationRef, update);
    tx.update(roundRef, { counters: nextCounters, updatedAt: nowIso });
    itemRecords.forEach(({ expected }, index) => {
      tx.update(this.firestore.doc(`saleRoundItems/${expected.roundItemId}`), {
        reservedQuantity: nextItemCounters[index].nextReserved,
        orderedQuantity: nextItemCounters[index].nextOrdered,
        updatedAt: nowIso,
      });
    });
    return {
      reservation: { ...reservation, ...update } as ReservationRecord,
      counters: nextCounters,
    };
  }

  /**
   * Atomic late-payment reacquisition + consume.
   * Single transaction, single commit, no intermediate external HELD leak:
   * - deterministic reservation identity `late-payment:${orderId}`
   * - all reads (reservation + round + items) before any write
   * - idempotency: same order/payment CONSUMED retry => 0 move
   * - fresh: create CONSUMED directly with ordered projection only
   * - orphan HELD (same deterministic id): consume it (reserved->ordered)
   * - capacity full / missing / window / city => LatePaymentCapacityError
   *   (caller converges to late-payment refund policy, no orphan).
   */
  async reacquireAndConsumeLatePaymentInTransaction(
    tx: any,
    input: {
      storeId: string;
      roundId: string;
      userId: string;
      orderId: string;
      paymentId: string;
      deliveryAddress: DeliveryAddressInput;
      items: RoundItemInput[];
      idempotencyKey?: string;
    },
  ): Promise<ReservationRecord> {
    const idempotencyKey = input.idempotencyKey ?? `late-payment:${input.orderId}`;
    const reservationId = this.reservationId(input.storeId, input.roundId, idempotencyKey);
    const reservationRef = this.firestore.doc(`checkoutReservations/${reservationId}`);

    // Read phase first (no writes yet).
    const reservationSnap = await tx.get(reservationRef);
    if (reservationSnap.exists) {
      const existing = reservationSnap.data() as ReservationRecord;
      if (existing.roundId !== input.roundId || existing.storeId !== input.storeId) {
        throw new ConflictException('이미 닫힌 결제 예약입니다.');
      }
      if (existing.status === 'CONSUMED') {
        if (
          existing.orderId !== input.orderId ||
          (existing.paymentId != null &&
            input.paymentId != null &&
            existing.paymentId !== input.paymentId)
        ) {
          throw new ConflictException('이미 닫힌 결제 예약입니다.');
        }
        return existing;
      }
      if (existing.status === 'HELD') {
        // Orphan HELD from a pre-fix crash or concurrent attempt with the same
        // deterministic identity: consume it exactly once. Reuse the generic
        // consume path so expiry/underflow/missing semantics stay single-owner.
        // Note: orphan items (reservation.items) are authoritative, not input.
        return this.moveReservationInTransaction(tx, reservationId, 'CONSUMED', {
          orderId: input.orderId,
          paymentId: input.paymentId,
        });
      }
      // RELEASED/EXPIRED with the same deterministic late identity must not
      // be resurrected into CONSUMED; converge to refund without leak.
      throw new LatePaymentCapacityError('결제 만료 후 회차 한도 마감');
    }

    const normalizedItems = this.normalizeItems(input.items);
    const roundRef = this.firestore.doc(`saleRounds/${input.roundId}`);
    const roundSnap = await tx.get(roundRef);
    if (!roundSnap.exists || roundSnap.data()?.['storeId'] !== input.storeId) {
      throw new LatePaymentCapacityError('결제 만료 후 회차 한도 마감');
    }
    const round = roundSnap.data() as Record<string, any>;
    const now = this.firestore.Timestamp.now();
    const nowMillis = timestampMillis(now);
    if (!Number.isFinite(nowMillis)) {
      throw new LatePaymentCapacityError('결제 만료 후 회차 한도 마감');
    }
    // Window / city / upper-bound failures all converge to refund (no orphan).
    try {
      this.assertRoundReservable(round, nowMillis);
    } catch {
      throw new LatePaymentCapacityError('결제 만료 후 회차 한도 마감');
    }
    try {
      this.assertDeliveryCity(input.deliveryAddress.address, round['deliveryRegion']?.['city']);
    } catch {
      throw new LatePaymentCapacityError('결제 만료 후 회차 한도 마감');
    }
    const itemSnaps = await Promise.all(
      normalizedItems.map((item) => tx.get(this.firestore.doc(`saleRoundItems/${item.roundItemId}`))),
    );
    const itemRecords = itemSnaps.map((snap, index) => {
      if (!snap.exists) throw new LatePaymentCapacityError('결제 만료 후 회차 한도 마감');
      const data = snap.data() as Record<string, any> | undefined;
      if (!data) throw new LatePaymentCapacityError('결제 만료 후 회차 한도 마감');
      if (data['roundId'] !== input.roundId || data['storeId'] !== input.storeId) {
        throw new LatePaymentCapacityError('결제 만료 후 회차 한도 마감');
      }
      if (data['status'] !== 'ACTIVE') {
        throw new LatePaymentCapacityError('결제 만료 후 회차 한도 마감');
      }
      return { input: normalizedItems[index], data };
    });
    const totalQuantity = normalizedItems.reduce((sum, item) => sum + item.quantity, 0);
    try {
      this.assertRoundCapacity(round, totalQuantity);
    } catch {
      throw new LatePaymentCapacityError('결제 만료 후 회차 한도 마감');
    }
    try {
      itemRecords.forEach((item) => this.assertItemCapacity(item.data, item.input.quantity));
    } catch {
      throw new LatePaymentCapacityError('결제 만료 후 회차 한도 마감');
    }
    itemRecords.forEach((item) => {
      this.assertFiniteCounter(item.data['reservedQuantity'], 'item');
      this.assertFiniteCounter(item.data['orderedQuantity'], 'item');
    });

    // Write phase: create CONSUMED directly (no intermediate HELD) + ordered only.
    const nowIso = this.toDate(now).toISOString();
    const reservation: ReservationRecord = {
      id: reservationId,
      roundId: input.roundId,
      storeId: input.storeId,
      userId: input.userId,
      orderId: input.orderId,
      paymentId: input.paymentId,
      status: 'CONSUMED',
      addressKey: this.addressKey(input.deliveryAddress),
      deliveryAddressCount: 1,
      itemQuantityTotal: totalQuantity,
      items: itemRecords.map((item) => ({
        roundItemId: item.input.roundItemId,
        productId: item.data['productId'],
        productName: item.data['productNameSnapshot'],
        productImageUrl: item.data['productImageUrlSnapshot'] ?? null,
        quantity: item.input.quantity,
        unitPrice: item.data['roundPrice'],
      })),
      idempotencyKey,
      expiresAt: new Date(nowMillis + 15 * 60_000).toISOString(),
      consumedAt: nowIso,
      releasedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const nextCounters = this.nextCountersOrThrow(round['counters'], {
      orderedDeliveryAddresses: 1,
      orderedItemQuantity: totalQuantity,
    });
    tx.set(reservationRef, reservation);
    tx.update(roundRef, { counters: nextCounters, updatedAt: nowIso });
    itemRecords.forEach((item) => {
      tx.update(this.firestore.doc(`saleRoundItems/${item.input.roundItemId}`), {
        orderedQuantity:
          this.assertFiniteCounter(item.data['orderedQuantity'], 'item') + item.input.quantity,
        updatedAt: nowIso,
      });
    });
    return reservation;
  }

  private async moveReservation(
    reservationId: string,
    nextStatus: Exclude<ReservationStatus, 'HELD'>,
    patch: { orderId?: string | null; paymentId?: string | null },
  ): Promise<ReservationRecord> {
    let result: ReservationRecord | null = null;

    await this.firestore.runTransaction(async (tx: any) => {
      result = await this.moveReservationInTransaction(tx, reservationId, nextStatus, patch);
    });

    return result!;
  }

  private async moveReservationInTransaction(
    tx: any,
    reservationId: string,
    nextStatus: Exclude<ReservationStatus, 'HELD'>,
    patch: { orderId?: string | null; paymentId?: string | null },
  ): Promise<ReservationRecord> {
    const reservationRef = this.firestore.doc(`checkoutReservations/${reservationId}`);
    const reservationSnap = await tx.get(reservationRef);
    if (!reservationSnap.exists) throw new NotFoundException('결제 예약을 찾을 수 없습니다.');

    const reservation = reservationSnap.data() as ReservationRecord;
    if (reservation.status === nextStatus) {
      if (
        nextStatus === 'CONSUMED' &&
        (reservation.orderId !== patch.orderId ||
          (patch.paymentId != null && reservation.paymentId !== patch.paymentId))
      ) {
        throw new ConflictException('이미 닫힌 결제 예약입니다.');
      }
      return reservation;
    }
    // RELEASED <-> EXPIRED cross-path retry converges without moving counters.
    // Both are terminal release states; the first terminal status is preserved
    // for forensic meaning (no status flip, no counter move, no throw).
    // CONSUMED is never treated as equivalent to a release terminal.
    const isReleaseTerminal = (status: ReservationStatus) =>
      status === 'RELEASED' || status === 'EXPIRED';
    if (isReleaseTerminal(reservation.status) && isReleaseTerminal(nextStatus)) {
      return reservation;
    }
    if (nextStatus === 'CONSUMED') {
      if (reservation.status !== 'HELD') {
        throw new ConflictException('이미 닫힌 결제 예약입니다.');
      }
      const clock = this.firestore.Timestamp.now();
      const clockMillis = timestampMillis(clock);
      if (!Number.isFinite(clockMillis)) {
        throw new ConflictException('예약 만료 시각을 확인할 수 없습니다.');
      }
      if (new Date(reservation.expiresAt).getTime() <= clockMillis) {
        throw new ConflictException('만료된 결제 예약입니다.');
      }
    }
    const releasingConsumed = reservation.status === 'CONSUMED' && nextStatus === 'RELEASED';
    const consumingHeld = reservation.status === 'HELD' && nextStatus === 'CONSUMED';
    const releasingHeld =
      reservation.status === 'HELD' && ['RELEASED', 'EXPIRED'].includes(nextStatus);
    if (!releasingConsumed && !consumingHeld && !releasingHeld) {
      throw new ConflictException('이미 닫힌 결제 예약입니다.');
    }

    // All reads before any writes (Firestore read-before-write rule).
    const roundRef = this.firestore.doc(`saleRounds/${reservation.roundId}`);
    const roundSnap = await tx.get(roundRef);
    if (!roundSnap.exists || roundSnap.data()?.['storeId'] !== reservation.storeId) {
      throw new NotFoundException('회차를 찾을 수 없습니다.');
    }

    const round = roundSnap.data() as Record<string, any>;
    const itemSnaps = await Promise.all(
      reservation.items.map((item) =>
        tx.get(this.firestore.doc(`saleRoundItems/${item.roundItemId}`)),
      ),
    );
    // Explicit missing/corrupt projection guard: never let undefined data()
    // become a TypeError-driven abort, and never partially apply.
    const itemRecords = itemSnaps.map((snap, index) => {
      if (!snap.exists) throw new NotFoundException('회차 상품을 찾을 수 없습니다.');
      const data = snap.data() as Record<string, any> | undefined;
      if (!data) throw new NotFoundException('회차 상품을 찾을 수 없습니다.');
      const expected = reservation.items[index];
      if (data['roundId'] !== reservation.roundId || data['storeId'] !== reservation.storeId) {
        throw new NotFoundException('회차 상품을 찾을 수 없습니다.');
      }
      if (
        typeof expected.quantity !== 'number' ||
        !Number.isInteger(expected.quantity) ||
        expected.quantity < 1
      ) {
        throw new ConflictException('회차 상품 수량 상태가 올바르지 않아 처리할 수 없습니다.');
      }
      return { expected, data };
    });
    const now = this.toDate(this.firestore.Timestamp.now()).toISOString();
    const consumed = nextStatus === 'CONSUMED';
    const wasConsumed = reservation.status === 'CONSUMED';
    const update: Partial<ReservationRecord> = {
      status: nextStatus,
      orderId: patch.orderId ?? reservation.orderId,
      paymentId: patch.paymentId ?? reservation.paymentId,
      consumedAt: consumed ? now : reservation.consumedAt,
      releasedAt: consumed ? reservation.releasedAt : now,
      updatedAt: now,
    };

    // Fail-closed lower-bound validation before any write.
    const roundDelta = {
      reservedDeliveryAddresses: wasConsumed ? 0 : -1,
      reservedItemQuantity: wasConsumed ? 0 : -reservation.itemQuantityTotal,
      orderedDeliveryAddresses: consumed ? 1 : wasConsumed ? -1 : 0,
      orderedItemQuantity: consumed
        ? reservation.itemQuantityTotal
        : wasConsumed
          ? -reservation.itemQuantityTotal
          : 0,
    };
    const nextRoundCounters = this.nextCountersOrThrow(round['counters'], roundDelta);
    const nextItemCounters = itemRecords.map(({ expected, data }) => {
      const reserved = this.assertFiniteCounter(data['reservedQuantity'], 'item');
      const ordered = this.assertFiniteCounter(data['orderedQuantity'], 'item');
      const nextReserved = wasConsumed ? reserved : reserved - expected.quantity;
      const nextOrdered = consumed
        ? ordered + expected.quantity
        : wasConsumed
          ? ordered - expected.quantity
          : ordered;
      if (nextReserved < 0 || nextOrdered < 0) {
        throw new ConflictException('회차 상품 수량 상태가 올바르지 않아 처리할 수 없습니다.');
      }
      return { nextReserved, nextOrdered };
    });

    tx.update(reservationRef, update);
    tx.update(roundRef, {
      counters: nextRoundCounters,
      updatedAt: now,
    });

    itemRecords.forEach(({ expected }, index) => {
      tx.update(this.firestore.doc(`saleRoundItems/${expected.roundItemId}`), {
        reservedQuantity: nextItemCounters[index].nextReserved,
        orderedQuantity: nextItemCounters[index].nextOrdered,
        updatedAt: now,
      });
    });

    return { ...reservation, ...update } as ReservationRecord;
  }

  private assertRoundReservable(round: Record<string, any>, nowMillis: number) {
    assertOrderWindowOpen(round as SaleRoundRecord, nowMillis);
  }

  private assertRoundCapacity(round: Record<string, any>, itemQuantityTotal: number) {
    const counters = this.counters(round['counters']);
    const limits = round['limits'] ?? {};
    const addressTotal = counters.reservedDeliveryAddresses + counters.orderedDeliveryAddresses + 1;
    const itemTotal =
      counters.reservedItemQuantity + counters.orderedItemQuantity + itemQuantityTotal;
    if (addressTotal > (limits['maxDeliveryAddresses'] ?? 0)) {
      throw new ConflictException('이번 회차 배송지 한도가 마감되었습니다.');
    }
    if (itemTotal > (limits['maxItemQuantity'] ?? 0)) {
      throw new ConflictException('이번 회차 상품 수량 한도가 마감되었습니다.');
    }
  }

  private assertDeliveryCity(address: string, city?: string) {
    if (!city) throw new BadRequestException('배송 가능 지역이 설정되지 않았습니다.');
    const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const boundary = new RegExp(`^(?:(?:경기도|경기)\\s+)?${escapedCity}(?:\\s|$)`);
    if (!boundary.test(address.trim())) {
      throw new BadRequestException('배송 가능 지역의 주소만 주문할 수 있습니다.');
    }
  }

  private assertItemCapacity(item: Record<string, any>, quantity: number) {
    const nextQuantity =
      (item['reservedQuantity'] ?? 0) + (item['orderedQuantity'] ?? 0) + quantity;
    if (nextQuantity > (item['saleLimitQuantity'] ?? 0)) {
      throw new ConflictException('회차 상품 수량이 마감되었습니다.');
    }
  }

  private normalizeItems(items: RoundItemInput[]) {
    if (!items.length) throw new BadRequestException('회차 상품이 필요합니다.');
    const seen = new Set<string>();
    return items.map((item) => {
      if (!item.roundItemId || !Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new BadRequestException('회차 상품 수량이 올바르지 않습니다.');
      }
      if (seen.has(item.roundItemId)) {
        throw new BadRequestException('같은 회차 상품을 중복으로 주문할 수 없습니다.');
      }
      seen.add(item.roundItemId);
      return { roundItemId: item.roundItemId, quantity: item.quantity };
    });
  }

  private counters(raw: Partial<CapacityCounters> | null | undefined): CapacityCounters {
    return {
      reservedDeliveryAddresses: raw?.reservedDeliveryAddresses ?? 0,
      reservedItemQuantity: raw?.reservedItemQuantity ?? 0,
      orderedDeliveryAddresses: raw?.orderedDeliveryAddresses ?? 0,
      orderedItemQuantity: raw?.orderedItemQuantity ?? 0,
      heldOrderCount: raw?.heldOrderCount ?? 0,
    };
  }

  private countersStrict(
    raw: Partial<CapacityCounters> | null | undefined,
    scope: 'round',
  ): CapacityCounters {
    const current = this.counters(raw);
    (Object.keys(current) as Array<keyof CapacityCounters>).forEach((key) => {
      const value = current[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ConflictException('회차 예약 상태가 올바르지 않아 처리할 수 없습니다.');
      }
    });
    return current;
  }

  private assertFiniteCounter(value: unknown, scope: 'item'): number {
    const numeric = (value ?? 0) as unknown;
    if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
      throw new ConflictException('회차 상품 수량 상태가 올바르지 않아 처리할 수 없습니다.');
    }
    return numeric;
  }

  // Fail-closed lower bound: any decrement that would take a counter below
  // zero aborts the transaction with an explicit domain error. No Math.max
  // clamp is used anywhere in this service.
  private nextCountersOrThrow(
    raw: Partial<CapacityCounters> | null | undefined,
    delta: Partial<CapacityCounters>,
  ): CapacityCounters {
    const current = this.countersStrict(raw, 'round');
    const next: CapacityCounters = {
      reservedDeliveryAddresses:
        current.reservedDeliveryAddresses + (delta.reservedDeliveryAddresses ?? 0),
      reservedItemQuantity: current.reservedItemQuantity + (delta.reservedItemQuantity ?? 0),
      orderedDeliveryAddresses:
        current.orderedDeliveryAddresses + (delta.orderedDeliveryAddresses ?? 0),
      orderedItemQuantity: current.orderedItemQuantity + (delta.orderedItemQuantity ?? 0),
      heldOrderCount: current.heldOrderCount + (delta.heldOrderCount ?? 0),
    };
    const underflow = (Object.keys(next) as Array<keyof CapacityCounters>).some(
      (key) => !Number.isFinite(next[key]) || next[key] < 0,
    );
    if (underflow) {
      if ((delta.heldOrderCount ?? 0) < 0) {
        throw new ConflictException('회차 보류 주문 수가 이미 정리되었습니다.');
      }
      throw new ConflictException('회차 예약 상태가 올바르지 않아 처리할 수 없습니다.');
    }
    return next;
  }

  private reservationId(storeId: string, roundId: string, idempotencyKey: string) {
    return createHash('sha256')
      .update(`${storeId}:${roundId}:${idempotencyKey}`)
      .digest('hex')
      .slice(0, 32);
  }

  private addressKey(address: DeliveryAddressInput) {
    return [address.zipCode, address.address, address.addressDetail ?? '']
      .map((value) =>
        String(value ?? '')
          .trim()
          .replace(/\s+/g, ' '),
      )
      .join('|');
  }

  private toDate(value: any): Date {
    if (value instanceof Date) return value;
    if (typeof value?.toDate === 'function') return value.toDate();
    return new Date(value);
  }
}
