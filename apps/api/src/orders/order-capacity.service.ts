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
  resolveAutomaticState,
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

// 같은 고객이 같은 회차에서 새 결제를 시작해 대체된 이전 결제 전 주문의 취소 사유.
// 이 주문에 결제가 뒤늦게 확인되면 기존 '취소 후 확인된 결제' 환불 경로로 정리된다.
export const SUPERSEDED_CHECKOUT_CANCEL_REASON = 'superseded';

const PREVIOUS_CHECKOUT_IN_PROGRESS_MESSAGE =
  '이전 결제를 처리하고 있습니다. 잠시 후 주문 내역을 확인해 주세요.';

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
    const now = this.firestore.Timestamp.now();
    // 같은 고객의 같은 회차 활성 예약은 1건만 둔다. 이전 결제 시도의 예약은 아래에서
    // 같은 트랜잭션으로 반환한다(읽기는 모두 쓰기 전에 끝낸다). 반환할 예약을 뺀 한도로
    // 회차 상태와 새 예약을 판정하므로, 고객 자신의 이전 시도 때문에 재시도가 마감으로
    // 거절되지 않는다.
    const superseded = await this.readSupersededHoldsInTransaction(tx, {
      storeId: input.storeId,
      roundId: input.roundId,
      userId: input.userId,
      nowMillis: timestampMillis(now),
    });
    const storedRound = roundSnap.data() as Record<string, any>;
    const { round, statusTransition } = this.effectiveRound(
      superseded.length === 0
        ? storedRound
        : {
            ...storedRound,
            counters: this.nextCountersOrThrow(storedRound['counters'], {
              reservedDeliveryAddresses: -superseded.length,
              reservedItemQuantity: -superseded.reduce(
                (sum, { reservation }) => sum + reservation.itemQuantityTotal,
                0,
              ),
            }),
          },
      timestampMillis(now),
    );
    this.assertRoundReservable(round, timestampMillis(now));
    this.assertDeliveryCity(input.deliveryAddress.address, round['deliveryRegion']?.['city']);

    const normalizedItems = this.normalizeItems(input.items);
    const nowMillis = timestampMillis(now);
    if (!Number.isFinite(nowMillis)) {
      throw new ConflictException('예약 시각을 확인할 수 없습니다.');
    }
    const supersededQuantityByItem = new Map<string, number>();
    superseded.forEach(({ reservation }) => {
      reservation.items.forEach((item) => {
        if (!Number.isInteger(item.quantity) || item.quantity < 1) {
          throw new ConflictException('회차 상품 수량 상태가 올바르지 않아 처리할 수 없습니다.');
        }
        supersededQuantityByItem.set(
          item.roundItemId,
          (supersededQuantityByItem.get(item.roundItemId) ?? 0) + item.quantity,
        );
      });
    });
    const touchedItemIds = [
      ...new Set([
        ...normalizedItems.map((item) => item.roundItemId),
        ...supersededQuantityByItem.keys(),
      ]),
    ];
    const touchedItemSnaps = await Promise.all(
      touchedItemIds.map((roundItemId) =>
        tx.get(this.firestore.doc(`saleRoundItems/${roundItemId}`)),
      ),
    );
    const touchedItems = touchedItemSnaps.map((snap, index) => {
      if (!snap.exists) throw new NotFoundException('회차 상품을 찾을 수 없습니다.');
      const data = snap.data() as Record<string, any> | undefined;
      if (!data || data['roundId'] !== input.roundId || data['storeId'] !== input.storeId) {
        throw new NotFoundException('회차 상품을 찾을 수 없습니다.');
      }
      const roundItemId = touchedItemIds[index];
      const reservedAfterRelease =
        this.assertFiniteCounter(data['reservedQuantity'], 'item') -
        (supersededQuantityByItem.get(roundItemId) ?? 0);
      this.assertFiniteCounter(data['orderedQuantity'], 'item');
      if (reservedAfterRelease < 0) {
        throw new ConflictException('회차 상품 수량 상태가 올바르지 않아 처리할 수 없습니다.');
      }
      return { roundItemId, data, reservedAfterRelease };
    });
    const touchedById = new Map(touchedItems.map((touched) => [touched.roundItemId, touched]));
    const itemRecords = normalizedItems.map((item) => {
      const touched = touchedById.get(item.roundItemId);
      if (!touched) throw new NotFoundException('회차 상품을 찾을 수 없습니다.');
      if (touched.data['status'] !== 'ACTIVE') {
        throw new ConflictException('구매할 수 없는 회차 상품입니다.');
      }
      return {
        input: item,
        data: touched.data,
        reservedAfterRelease: touched.reservedAfterRelease,
      };
    });

    const totalQuantity = normalizedItems.reduce((sum, item) => sum + item.quantity, 0);
    this.assertRoundCapacity(round, totalQuantity);
    itemRecords.forEach((item) => {
      this.assertItemCapacity(
        { ...item.data, reservedQuantity: item.reservedAfterRelease },
        item.input.quantity,
      );
    });

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
    const newQuantityByItem = new Map(
      normalizedItems.map((item) => [item.roundItemId, item.quantity] as const),
    );

    superseded.forEach(({ reservation: previous, orderRef }) => {
      tx.update(this.firestore.doc(`checkoutReservations/${previous.id}`), {
        status: 'RELEASED',
        releasedAt: nowIso,
        updatedAt: nowIso,
      });
      if (orderRef) {
        tx.update(orderRef, {
          status: 'CANCELLED',
          cancelReason: SUPERSEDED_CHECKOUT_CANCEL_REASON,
          updatedAt: now,
        });
      }
    });
    tx.set(reservationRef, reservation);
    tx.update(roundRef, {
      ...statusTransition,
      counters: nextReserveCounters,
      updatedAt: nowIso,
    });
    touchedItems.forEach(({ roundItemId, reservedAfterRelease }) => {
      tx.update(this.firestore.doc(`saleRoundItems/${roundItemId}`), {
        reservedQuantity: reservedAfterRelease + (newQuantityByItem.get(roundItemId) ?? 0),
        updatedAt: nowIso,
      });
    });
    return reservation;
  }

  /**
   * 같은 (회차, 고객)의 만료 전 HELD 예약을 찾아, 새 결제 시도로 대체해도 안전한지
   * 판정한다. 읽기만 하고 쓰지 않는다.
   * - 연결 주문이 결제 전 PENDING이고 결제 기록·취소 진행이 없으면 대체 대상이다.
   * - 연결 주문이 없으면(주문 없이 남은 예약) 결제될 수 없으므로 대체 대상이다.
   * - 그 밖에는 이전 결제가 처리 중일 수 있으므로 반환하지 않고 409로 거절한다.
   * 만료 시각이 지난 HELD는 결제 조회 뒤 정리하는 15분 scheduler에 맡긴다.
   * 결제 확인 뒤 소비되는 늦은 결제 예약(`late-payment:`)은 대상이 아니다.
   */
  private async readSupersededHoldsInTransaction(
    tx: any,
    input: { storeId: string; roundId: string; userId: string; nowMillis: number },
  ): Promise<Array<{ reservation: ReservationRecord; orderRef: unknown | null }>> {
    const heldSnap = await tx.get(
      this.firestore
        .collection('checkoutReservations')
        .where('roundId', '==', input.roundId)
        .where('userId', '==', input.userId)
        .where('status', '==', 'HELD'),
    );
    const active = (heldSnap.docs as Array<{ data(): unknown }>)
      .map((snap) => snap.data() as ReservationRecord)
      .filter(
        (held) =>
          held.storeId === input.storeId &&
          !String(held.idempotencyKey ?? '').startsWith('late-payment:') &&
          new Date(held.expiresAt).getTime() > input.nowMillis,
      );

    const superseded: Array<{ reservation: ReservationRecord; orderRef: unknown | null }> = [];
    for (const held of active) {
      if (!Array.isArray(held.items) || held.items.length === 0) {
        throw new ConflictException(PREVIOUS_CHECKOUT_IN_PROGRESS_MESSAGE);
      }
      const orderSnap = await tx.get(
        this.firestore.collection('orders').where('reservationId', '==', held.id).limit(2),
      );
      const orderDocs = orderSnap.docs as Array<{ id: string; ref: unknown; data(): unknown }>;
      if (orderDocs.length === 0) {
        superseded.push({ reservation: held, orderRef: null });
        continue;
      }
      if (orderDocs.length > 1) {
        throw new ConflictException(PREVIOUS_CHECKOUT_IN_PROGRESS_MESSAGE);
      }
      const order = orderDocs[0].data() as Record<string, any>;
      const paymentSnap = await tx.get(this.firestore.doc(`payments/${orderDocs[0].id}`));
      const replaceable =
        order['status'] === 'PENDING' &&
        order['schemaVersion'] === 2 &&
        order['storeId'] === input.storeId &&
        order['roundId'] === input.roundId &&
        order['userId'] === input.userId &&
        order['cancellation'] == null &&
        !paymentSnap.exists;
      if (!replaceable) {
        throw new ConflictException(PREVIOUS_CHECKOUT_IN_PROGRESS_MESSAGE);
      }
      superseded.push({ reservation: held, orderRef: orderDocs[0].ref });
    }
    return superseded;
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

  /**
   * `allowLapsedHold`: 결제 제공자가 PAID를 확인한 PENDING 주문만 쓴다. 만료됐어도 아직
   * HELD인 예약은 해제된 적이 없어 그 한도를 계속 차지하고 있으므로, 같은 예약을
   * reserved→ordered로 옮겨도 한도를 넘지 않는다.
   */
  async consumeReservationInTransaction(
    tx: any,
    input: {
      reservationId: string;
      orderId: string;
      paymentId?: string | null;
      allowLapsedHold?: boolean;
    },
  ): Promise<ReservationRecord> {
    return this.moveReservationInTransaction(
      tx,
      input.reservationId,
      'CONSUMED',
      { orderId: input.orderId, paymentId: input.paymentId ?? null },
      { allowLapsedHold: input.allowLapsedHold === true },
    );
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
    const now = this.firestore.Timestamp.now();
    const nowMillis = timestampMillis(now);
    if (!Number.isFinite(nowMillis)) {
      throw new LatePaymentCapacityError('결제 만료 후 회차 한도 마감');
    }
    const { round, statusTransition } = this.effectiveRound(
      roundSnap.data() as Record<string, any>,
      nowMillis,
    );
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
    tx.update(roundRef, { ...statusTransition, counters: nextCounters, updatedAt: nowIso });
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
    options: { allowLapsedHold?: boolean } = {},
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
      if (new Date(reservation.expiresAt).getTime() <= clockMillis && !options.allowLapsedHold) {
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

  // 공개 조회와 같은 자동 상태 계산으로 판정한다. 저장값이 아직 SCHEDULED여도
  // 주문 시작 시각이 지났으면 OPEN으로 보고, 예약이 성립하면 그 전이를 같은
  // 트랜잭션에서 함께 저장한다(refreshStatus와 같은 규칙).
  private effectiveRound(stored: Record<string, any>, nowMillis: number) {
    const next = resolveAutomaticState(stored as SaleRoundRecord, nowMillis);
    const changed = next.status !== stored['status'] || next.closeReason !== stored['closeReason'];
    return {
      round: changed ? { ...stored, ...next } : stored,
      statusTransition: changed ? next : {},
    };
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
