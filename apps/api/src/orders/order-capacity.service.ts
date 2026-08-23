import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { FirestoreService } from '../firestore/firestore.service';

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
    this.assertRoundReservable(round);
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

    const now = this.nowIso();
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
      expiresAt: this.plusMinutesIso(15),
      consumedAt: null,
      releasedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    tx.set(reservationRef, reservation);
    tx.update(roundRef, {
      counters: this.nextCounters(round['counters'], {
        reservedDeliveryAddresses: 1,
        reservedItemQuantity: totalQuantity,
      }),
      updatedAt: now,
    });
    itemRecords.forEach((item) => {
      tx.update(this.firestore.doc(`saleRoundItems/${item.input.roundItemId}`), {
        reservedQuantity: (item.data['reservedQuantity'] ?? 0) + item.input.quantity,
        updatedAt: now,
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
    if (nextStatus === 'CONSUMED') {
      if (reservation.status !== 'HELD') {
        throw new ConflictException('이미 닫힌 결제 예약입니다.');
      }
      if (new Date(reservation.expiresAt).getTime() <= Date.now()) {
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
    const now = this.nowIso();
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

    tx.update(reservationRef, update);
    tx.update(roundRef, {
      counters: this.nextCounters(round['counters'], {
        reservedDeliveryAddresses: wasConsumed ? 0 : -1,
        reservedItemQuantity: wasConsumed ? 0 : -reservation.itemQuantityTotal,
        orderedDeliveryAddresses: consumed ? 1 : wasConsumed ? -1 : 0,
        orderedItemQuantity: consumed
          ? reservation.itemQuantityTotal
          : wasConsumed
            ? -reservation.itemQuantityTotal
            : 0,
      }),
      updatedAt: now,
    });

    reservation.items.forEach((item, index) => {
      const itemData = itemSnaps[index].data() as Record<string, any>;
      tx.update(this.firestore.doc(`saleRoundItems/${item.roundItemId}`), {
        reservedQuantity: wasConsumed
          ? (itemData['reservedQuantity'] ?? 0)
          : Math.max(0, (itemData['reservedQuantity'] ?? 0) - item.quantity),
        orderedQuantity: consumed
          ? (itemData['orderedQuantity'] ?? 0) + item.quantity
          : wasConsumed
            ? Math.max(0, (itemData['orderedQuantity'] ?? 0) - item.quantity)
            : (itemData['orderedQuantity'] ?? 0),
        updatedAt: now,
      });
    });

    return { ...reservation, ...update } as ReservationRecord;
  }

  private assertRoundReservable(round: Record<string, any>) {
    if (round['status'] !== 'OPEN') {
      throw new ConflictException('현재 주문 가능한 회차가 아닙니다.');
    }
    if (round['cancellation'] != null) {
      throw new ConflictException('취소 처리 중인 회차에는 주문할 수 없습니다.');
    }
    const closeAt = new Date(round['schedule']?.['orderCloseAt'] ?? 0).getTime();
    if (!Number.isFinite(closeAt) || closeAt <= Date.now()) {
      throw new ConflictException('주문 마감된 회차입니다.');
    }
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

  private nextCounters(
    raw: Partial<CapacityCounters> | null | undefined,
    delta: Partial<CapacityCounters>,
  ) {
    const current = this.counters(raw);
    return {
      reservedDeliveryAddresses: Math.max(
        0,
        current.reservedDeliveryAddresses + (delta.reservedDeliveryAddresses ?? 0),
      ),
      reservedItemQuantity: Math.max(
        0,
        current.reservedItemQuantity + (delta.reservedItemQuantity ?? 0),
      ),
      orderedDeliveryAddresses: Math.max(
        0,
        current.orderedDeliveryAddresses + (delta.orderedDeliveryAddresses ?? 0),
      ),
      orderedItemQuantity: Math.max(
        0,
        current.orderedItemQuantity + (delta.orderedItemQuantity ?? 0),
      ),
      heldOrderCount: Math.max(0, current.heldOrderCount + (delta.heldOrderCount ?? 0)),
    };
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

  private nowIso() {
    const now = this.firestore.Timestamp.now();
    return this.toDate(now).toISOString();
  }

  private plusMinutesIso(minutes: number) {
    return new Date(Date.now() + minutes * 60_000).toISOString();
  }

  private toDate(value: any): Date {
    if (value instanceof Date) return value;
    if (typeof value?.toDate === 'function') return value.toDate();
    return new Date(value);
  }
}
