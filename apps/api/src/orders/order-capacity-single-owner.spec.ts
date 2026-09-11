import { ConflictException, NotFoundException } from '@nestjs/common';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { OrderCapacityService } from './order-capacity.service';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';
import { OrdersLifecycleService } from './orders-lifecycle.service';
import { PaymentFinalizationService } from '../payments/payment-finalization.service';

type Data = Record<string, any>;

function seedBase(): Record<string, Data> {
  return {
    'stores/store-1': { id: 'store-1', salesMode: 'round_direct', ownerId: 'seller-1' },
    'users/user-1': { id: 'user-1', name: '고객', email: 'buyer@example.com' },
    'saleRounds/round-1': {
      id: 'round-1',
      storeId: 'store-1',
      status: 'OPEN',
      schedule: {
        orderOpenAt: '2026-07-14T00:00:00.000+09:00',
        orderCloseAt: '2099-07-20T00:00:00.000+09:00',
        timezone: 'Asia/Seoul',
      },
      deliveryRegion: { city: '이천시', enabled: true },
      limits: { maxDeliveryAddresses: 15, maxItemQuantity: 30 },
      counters: {
        reservedDeliveryAddresses: 0,
        reservedItemQuantity: 0,
        orderedDeliveryAddresses: 0,
        orderedItemQuantity: 0,
        heldOrderCount: 0,
      },
    },
    'saleRoundItems/round-item-1': {
      id: 'round-item-1',
      roundId: 'round-1',
      storeId: 'store-1',
      productId: 'product-1',
      productNameSnapshot: '미니 호접란',
      productImageUrlSnapshot: null,
      roundPrice: 50000,
      saleLimitQuantity: 20,
      reservedQuantity: 0,
      orderedQuantity: 0,
      status: 'ACTIVE',
    },
  };
}

function checkoutInput(overrides: Partial<Data> = {}) {
  return {
    storeId: 'store-1',
    roundId: 'round-1',
    userId: 'user-1',
    idempotencyKey: 'checkout-1',
    deliveryAddress: {
      address: '경기도 이천시 중리천로 1',
      addressDetail: '201호',
      zipCode: '17373',
    },
    items: [{ roundItemId: 'round-item-1', quantity: 2 }],
    ...overrides,
  };
}

describe('CAPACITY single-owner remediation proof', () => {
  it('A. HELD reserve moves reserved once and retry moves 0', async () => {
    const memory = createInMemoryFirestore(seedBase());
    const capacity = new OrderCapacityService(memory.firestore as never);

    const first = await capacity.reserveCheckout(checkoutInput());
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 1,
      reservedItemQuantity: 2,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
    });
    expect(memory.read('saleRoundItems/round-item-1')).toMatchObject({
      reservedQuantity: 2,
      orderedQuantity: 0,
    });

    const second = await capacity.reserveCheckout(checkoutInput());
    expect(second.id).toBe(first.id);
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 1,
      reservedItemQuantity: 2,
    });
    expect(memory.read('saleRoundItems/round-item-1')).toMatchObject({ reservedQuantity: 2 });
  });

  it('B. HELD->CONSUMED moves reserved->ordered once and retry moves 0', async () => {
    const memory = createInMemoryFirestore(seedBase());
    const capacity = new OrderCapacityService(memory.firestore as never);
    const reservation = await capacity.reserveCheckout(checkoutInput());

    await capacity.consumeReservation({ reservationId: reservation.id, orderId: 'order-1' });
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 1,
      orderedItemQuantity: 2,
    });
    expect(memory.read('saleRoundItems/round-item-1')).toMatchObject({
      reservedQuantity: 0,
      orderedQuantity: 2,
    });

    await capacity.consumeReservation({ reservationId: reservation.id, orderId: 'order-1' });
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 1,
      orderedItemQuantity: 2,
    });
    expect(memory.read('saleRoundItems/round-item-1')).toMatchObject({
      reservedQuantity: 0,
      orderedQuantity: 2,
    });
  });

  it('C. HELD->RELEASED decrements reserved exactly once', async () => {
    const memory = createInMemoryFirestore(seedBase());
    const capacity = new OrderCapacityService(memory.firestore as never);
    const reservation = await capacity.reserveCheckout(checkoutInput());

    await capacity.releaseReservation(reservation.id, 'RELEASED');
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
    });
    expect(memory.read('saleRoundItems/round-item-1')).toMatchObject({
      reservedQuantity: 0,
      orderedQuantity: 0,
    });

    await capacity.releaseReservation(reservation.id, 'RELEASED');
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
    });
  });

  it('D. HELD->EXPIRED decrements reserved exactly once', async () => {
    const memory = createInMemoryFirestore(seedBase());
    const capacity = new OrderCapacityService(memory.firestore as never);
    const reservation = await capacity.reserveCheckout(
      checkoutInput({ idempotencyKey: 'checkout-expire' }),
    );

    await capacity.releaseReservation(reservation.id, 'EXPIRED');
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
    });
    expect(memory.read('checkoutReservations/' + reservation.id)?.status).toBe('EXPIRED');

    await capacity.releaseReservation(reservation.id, 'EXPIRED');
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
    });
  });

  it('E. RELEASED<->EXPIRED cross-status retry converges with 0 move and no throw', async () => {
    const memory = createInMemoryFirestore(seedBase());
    const capacity = new OrderCapacityService(memory.firestore as never);
    const reservation = await capacity.reserveCheckout(
      checkoutInput({ idempotencyKey: 'checkout-cross' }),
    );

    await capacity.releaseReservation(reservation.id, 'RELEASED');
    const afterRelease = JSON.parse(JSON.stringify(memory.read('saleRounds/round-1')?.counters));
    const afterReleaseItem = JSON.parse(JSON.stringify(memory.read('saleRoundItems/round-item-1')));

    await expect(
      capacity.releaseReservation(reservation.id, 'EXPIRED'),
    ).resolves.toMatchObject({ id: reservation.id });
    expect(memory.read('saleRounds/round-1')?.counters).toEqual(afterRelease);
    expect(memory.read('saleRoundItems/round-item-1')).toEqual(afterReleaseItem);
    // First terminal preserved for forensic meaning.
    expect(memory.read('checkoutReservations/' + reservation.id)?.status).toBe('RELEASED');

    const reservation2 = await capacity.reserveCheckout(
      checkoutInput({ idempotencyKey: 'checkout-cross-2' }),
    );
    await capacity.releaseReservation(reservation2.id, 'EXPIRED');
    const afterExpire = JSON.parse(JSON.stringify(memory.read('saleRounds/round-1')?.counters));
    await expect(
      capacity.releaseReservation(reservation2.id, 'RELEASED'),
    ).resolves.toMatchObject({ id: reservation2.id });
    expect(memory.read('saleRounds/round-1')?.counters).toEqual(afterExpire);
    expect(memory.read('checkoutReservations/' + reservation2.id)?.status).toBe('EXPIRED');
  });

  it('CONSUMED reuse by different order/payment stays fail-closed', async () => {
    const memory = createInMemoryFirestore(seedBase());
    const capacity = new OrderCapacityService(memory.firestore as never);
    const reservation = await capacity.reserveCheckout(checkoutInput());
    await capacity.consumeReservation({ reservationId: reservation.id, orderId: 'order-1' });

    await expect(
      capacity.consumeReservation({ reservationId: reservation.id, orderId: 'order-other' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('F. CONSUMED->RELEASED decrements ordered exactly once and retry moves 0', async () => {
    const memory = createInMemoryFirestore(seedBase());
    const capacity = new OrderCapacityService(memory.firestore as never);
    const reservation = await capacity.reserveCheckout(checkoutInput());
    await capacity.consumeReservation({ reservationId: reservation.id, orderId: 'order-1' });

    await capacity.releaseReservation(reservation.id, 'RELEASED');
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
    });
    expect(memory.read('saleRoundItems/round-item-1')).toMatchObject({
      reservedQuantity: 0,
      orderedQuantity: 0,
    });
    expect(memory.read('checkoutReservations/' + reservation.id)?.status).toBe('RELEASED');

    await capacity.releaseReservation(reservation.id, 'RELEASED');
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
    });
  });

  it('G. underflow aborts with no clamp and no terminal flip', async () => {
    const base = seedBase();
    (base['saleRounds/round-1'] as Data).counters = {
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
      heldOrderCount: 0,
    };
    (base['saleRoundItems/round-item-1'] as Data).reservedQuantity = 0;
    (base['saleRoundItems/round-item-1'] as Data).orderedQuantity = 0;
    base['checkoutReservations/corrupt-held'] = {
      id: 'corrupt-held',
      roundId: 'round-1',
      storeId: 'store-1',
      userId: 'user-1',
      orderId: null,
      paymentId: null,
      status: 'HELD',
      addressKey: 'test',
      deliveryAddressCount: 1,
      itemQuantityTotal: 2,
      items: [{ roundItemId: 'round-item-1', productId: 'product-1', quantity: 2, unitPrice: 50000 }],
      idempotencyKey: 'corrupt',
      expiresAt: '2099-01-01T00:00:00.000Z',
      consumedAt: null,
      releasedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const memory = createInMemoryFirestore(base);
    const capacity = new OrderCapacityService(memory.firestore as never);

    await expect(capacity.releaseReservation('corrupt-held', 'RELEASED')).rejects.toBeInstanceOf(
      ConflictException,
    );
    // No clamp: counters stay 0, reservation stays HELD.
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
    });
    expect(memory.read('saleRoundItems/round-item-1')).toMatchObject({
      reservedQuantity: 0,
      orderedQuantity: 0,
    });
    expect(memory.read('checkoutReservations/corrupt-held')?.status).toBe('HELD');

    // Corrupt CONSUMED ordered underflow also aborts.
    const base2 = seedBase();
    (base2['saleRounds/round-1'] as Data).counters.orderedDeliveryAddresses = 0;
    (base2['saleRounds/round-1'] as Data).counters.orderedItemQuantity = 0;
    base2['checkoutReservations/corrupt-consumed'] = {
      ...(base['checkoutReservations/corrupt-held'] as Data),
      id: 'corrupt-consumed',
      status: 'CONSUMED',
      orderId: 'order-1',
      paymentId: 'order-1',
    };
    const memory2 = createInMemoryFirestore(base2);
    const capacity2 = new OrderCapacityService(memory2.firestore as never);
    await expect(
      capacity2.releaseReservation('corrupt-consumed', 'RELEASED'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(memory2.read('checkoutReservations/corrupt-consumed')?.status).toBe('CONSUMED');
  });

  it('G2. corrupt heldOrderCount zero exit fails closed', async () => {
    const memory = createInMemoryFirestore(seedBase());
    const capacity = new OrderCapacityService(memory.firestore as never);
    await expect(
      memory.firestore.runTransaction((tx: unknown) =>
        capacity.adjustHeldOrderCountInTransaction(tx, {
          storeId: 'store-1',
          roundId: 'round-1',
          delta: -1,
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(0);
  });

  it('H. missing round/item fails with domain error, no TypeError, no partial', async () => {
    const memory = createInMemoryFirestore(seedBase());
    const capacity = new OrderCapacityService(memory.firestore as never);
    const reservation = await capacity.reserveCheckout(checkoutInput());

    // Delete round to simulate missing projection.
    await memory.firestore.doc('saleRounds/round-1').delete();
    await expect(
      capacity.releaseReservation(reservation.id, 'RELEASED'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(memory.read('checkoutReservations/' + reservation.id)?.status).toBe('HELD');

    // Restore round, delete item.
    const memory2 = createInMemoryFirestore(seedBase());
    const capacity2 = new OrderCapacityService(memory2.firestore as never);
    const reservation2 = await capacity2.reserveCheckout(checkoutInput());
    await memory2.firestore.doc('saleRoundItems/round-item-1').delete();
    await expect(capacity2.releaseReservation(reservation2.id, 'RELEASED')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(memory2.read('checkoutReservations/' + reservation2.id)?.status).toBe('HELD');
    // Round counters unchanged (still reserved, no partial release).
    expect(memory2.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 1,
      reservedItemQuantity: 2,
    });
  });

  it('I. DELIVERY_HELD cancellation decrements ordered+held exactly once with retry 0', async () => {
    const records: Record<string, Data> = {
      ...seedBase(),
      'saleRounds/round-1': {
        ...seedBase()['saleRounds/round-1'],
        counters: {
          reservedDeliveryAddresses: 0,
          reservedItemQuantity: 0,
          orderedDeliveryAddresses: 1,
          orderedItemQuantity: 2,
          heldOrderCount: 1,
        },
      },
      'saleRoundItems/round-item-1': {
        ...seedBase()['saleRoundItems/round-item-1'],
        reservedQuantity: 0,
        orderedQuantity: 2,
      },
      'checkoutReservations/reservation-held-cancel': {
        id: 'reservation-held-cancel',
        roundId: 'round-1',
        storeId: 'store-1',
        userId: 'user-1',
        orderId: 'order-held-1',
        paymentId: 'order-held-1',
        status: 'CONSUMED',
        addressKey: 'test',
        deliveryAddressCount: 1,
        itemQuantityTotal: 2,
        items: [{ roundItemId: 'round-item-1', productId: 'product-1', quantity: 2, unitPrice: 50000 }],
        idempotencyKey: 'held-cancel',
        expiresAt: '2099-01-01T00:00:00.000Z',
        consumedAt: '2026-01-01T00:00:00.000Z',
        releasedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      'orders/order-held-1': {
        id: 'order-held-1',
        storeId: 'store-1',
        userId: 'user-1',
        status: 'DELIVERY_HELD',
        schemaVersion: 2,
        roundId: 'round-1',
        reservationId: 'reservation-held-cancel',
        orderItems: [{ roundItemId: 'round-item-1', quantity: 2 }],
        deliveryMethod: 'direct',
      },
    };
    const memory = createInMemoryFirestore(records);
    const firestore = memory.firestore as never;
    const payments = {
      processRefundByOrderId: jest.fn().mockResolvedValue(undefined),
      refundOrderChargesByOrderId: jest.fn().mockResolvedValue(undefined),
    };
    const settlements = { cancelSettlement: jest.fn().mockResolvedValue(undefined) };
    const capacity = new OrderCapacityService(firestore);
    const roundLifecycle = new RoundOrderLifecycleService(
      firestore,
      payments as never,
      settlements as never,
      capacity as never,
    );

    // Claim first (LOCAL_PENDING) then apply cancellation via cancelForRound path.
    await memory.firestore.doc('orders/order-held-1').update({
      cancellation: { status: 'LOCAL_PENDING', reason: 'test', updatedAt: new Date().toISOString() },
    });
    await roundLifecycle.cancelForRound({
      storeId: 'store-1',
      orderId: 'order-held-1',
      expectedStatus: 'DELIVERY_HELD',
      reason: 'test cancel',
    });

    expect(memory.read('saleRounds/round-1')?.counters).toEqual({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
      heldOrderCount: 0,
    });
    expect(memory.read('saleRoundItems/round-item-1')).toMatchObject({
      reservedQuantity: 0,
      orderedQuantity: 0,
    });
    expect(memory.read('checkoutReservations/reservation-held-cancel')?.status).toBe('RELEASED');

    // Retry converges via order-level idempotency (already CANCELLED).
    const second = await roundLifecycle.cancelForRound({
      storeId: 'store-1',
      orderId: 'order-held-1',
      expectedStatus: 'CANCELLED' as never,
      reason: 'test cancel',
    });
    expect(second).toMatchObject({ orderId: 'order-held-1', status: 'CANCELLED' });
    expect(memory.read('saleRounds/round-1')?.counters).toEqual({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
      heldOrderCount: 0,
    });
  });

  it('J. held enter +1, valid exit -1, corrupt zero exit fail-closed', async () => {
    const memory = createInMemoryFirestore(seedBase());
    const capacity = new OrderCapacityService(memory.firestore as never);
    const adjust = (delta: number) =>
      memory.firestore.runTransaction((tx: unknown) =>
        capacity.adjustHeldOrderCountInTransaction(tx, {
          storeId: 'store-1',
          roundId: 'round-1',
          delta,
        }),
      );

    await adjust(1);
    expect(memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(1);

    await adjust(-1);
    expect(memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(0);

    await expect(adjust(-1)).rejects.toBeInstanceOf(ConflictException);
    expect(memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(0);
  });

  it('K. late PAID atomic: single commit, no orphan HELD, retry 0, full=>refund no leak', async () => {
    const lateOrder: Data = {
      id: 'order-late-1',
      storeId: 'store-1',
      userId: 'user-1',
      status: 'CANCELLED',
      cancelReason: 'timeout',
      schemaVersion: 2,
      roundId: 'round-1',
      saleType: 'normal',
      totalAmount: 100000,
      deliveryAddress: {
        address: '경기도 이천시 중리천로 1',
        addressDetail: '201호',
        zipCode: '17373',
      },
      orderItems: [{ roundItemId: 'round-item-1', quantity: 2 }],
    };
    const memory = createInMemoryFirestore({ ...seedBase(), 'orders/order-late-1': lateOrder });
    const firestore = memory.firestore as never;
    const capacity = new OrderCapacityService(firestore);
    const portone = { refund: jest.fn().mockResolvedValue(undefined), getPayment: jest.fn() };
    const finalization = new PaymentFinalizationService(
      firestore,
      portone as never,
      { sendToUser: jest.fn() } as never,
      { log: jest.fn() } as never,
      capacity as never,
      { createOrMergeIssue: jest.fn() } as never,
      { saveRecord: jest.fn().mockResolvedValue({}) } as never,
      { refundByOrderId: jest.fn() } as never,
    );
    const paymentData = {
      amount: { total: 100000 },
      status: 'PAID',
      method: { type: 'CARD' },
      transactionId: 'tx-late-1',
    } as never;

    const first = await finalization.finalizePaidOrder('order-late-1', paymentData);
    expect(first).toMatchObject({ status: 'ACCEPTED' });
    // No intermediate HELD leaked: deterministic late reservation is CONSUMED directly.
    const reservationId = memory.read('orders/order-late-1')?.reservationId as string;
    expect(typeof reservationId).toBe('string');
    expect(memory.read(`checkoutReservations/${reservationId}`)?.status).toBe('CONSUMED');
    expect(
      [...memory.records.keys()].filter((k) => k.startsWith('checkoutReservations/')),
    ).toHaveLength(1);
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 1,
      orderedItemQuantity: 2,
    });
    expect(memory.read('saleRoundItems/round-item-1')).toMatchObject({ orderedQuantity: 2 });

    const second = await finalization.finalizePaidOrder('order-late-1', paymentData);
    expect(second).toMatchObject({ reason: 'already_processed' });
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      orderedDeliveryAddresses: 1,
      orderedItemQuantity: 2,
    });

    // Capacity full => refund path with zero reservation leak.
    const fullBase = seedBase();
    (fullBase['saleRounds/round-1'] as Data).limits = {
      maxDeliveryAddresses: 0,
      maxItemQuantity: 0,
    };
    const fullMemory = createInMemoryFirestore({
      ...fullBase,
      'orders/order-late-full': { ...lateOrder, id: 'order-late-full' },
    });
    const fullCapacity = new OrderCapacityService(fullMemory.firestore as never);
    const fullPortone = { refund: jest.fn().mockResolvedValue(undefined), getPayment: jest.fn() };
    const fullFinalization = new PaymentFinalizationService(
      fullMemory.firestore as never,
      fullPortone as never,
      { sendToUser: jest.fn() } as never,
      { log: jest.fn() } as never,
      fullCapacity as never,
      { createOrMergeIssue: jest.fn() } as never,
      { saveRecord: jest.fn().mockResolvedValue({}) } as never,
      { refundByOrderId: jest.fn() } as never,
    );
    const fullResult = await fullFinalization.finalizePaidOrder('order-late-full', paymentData);
    expect(fullResult).toMatchObject({ reason: 'late_payment_refunded' });
    expect(fullPortone.refund).toHaveBeenCalledTimes(1);
    expect(
      [...fullMemory.records.keys()].filter((k) => k.startsWith('checkoutReservations/')),
    ).toHaveLength(0);
    expect(fullMemory.read('saleRounds/round-1')?.counters).toMatchObject({
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
    });
  });

  it('L. concurrency single-move: two consumes, consume vs expire', async () => {
    const memory = createInMemoryFirestore(seedBase());
    const capacity = new OrderCapacityService(memory.firestore as never);
    const reservation = await capacity.reserveCheckout(checkoutInput());

    const results = await Promise.allSettled([
      capacity.consumeReservation({ reservationId: reservation.id, orderId: 'order-1' }),
      capacity.consumeReservation({ reservationId: reservation.id, orderId: 'order-1' }),
    ]);
    // Same order/payment retry: both succeed idempotently (second is 0-move),
    // or one succeeds and the other converges without extra move. Either way
    // counters move exactly once.
    expect(memory.read('saleRounds/round-1')?.counters).toMatchObject({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 1,
      orderedItemQuantity: 2,
    });

    const memory2 = createInMemoryFirestore(seedBase());
    const capacity2 = new OrderCapacityService(memory2.firestore as never);
    const reservation2 = await capacity2.reserveCheckout(
      checkoutInput({ idempotencyKey: 'checkout-race-2' }),
    );
    const race = await Promise.allSettled([
      capacity2.consumeReservation({ reservationId: reservation2.id, orderId: 'order-2' }),
      capacity2.releaseReservation(reservation2.id, 'EXPIRED'),
    ]);
    // Exactly one path wins (CONSUMED or EXPIRED); counters reflect single move.
    const finalStatus = memory2.read(`checkoutReservations/${reservation2.id}`)?.status;
    expect(['CONSUMED', 'EXPIRED']).toContain(finalStatus);
    if (finalStatus === 'CONSUMED') {
      expect(memory2.read('saleRounds/round-1')?.counters).toMatchObject({
        reservedDeliveryAddresses: 0,
        orderedDeliveryAddresses: 1,
      });
    } else {
      expect(memory2.read('saleRounds/round-1')?.counters).toMatchObject({
        reservedDeliveryAddresses: 0,
        orderedDeliveryAddresses: 0,
      });
    }
    void race;
    void results;
  });

  it('3.6 outside-tx release is unreachable for valid round orders', async () => {
    const records: Record<string, Data> = {
      ...seedBase(),
      'orders/order-round-cancel': {
        id: 'order-round-cancel',
        storeId: 'store-1',
        userId: 'user-1',
        status: 'ACCEPTED',
        schemaVersion: 2,
        roundId: 'round-1',
        reservationId: 'reservation-round-cancel',
        orderItems: [{ roundItemId: 'round-item-1', quantity: 1 }],
      },
      'saleRounds/round-1': {
        ...seedBase()['saleRounds/round-1'],
        counters: {
          reservedDeliveryAddresses: 0,
          reservedItemQuantity: 0,
          orderedDeliveryAddresses: 1,
          orderedItemQuantity: 1,
          heldOrderCount: 0,
        },
      },
      'saleRoundItems/round-item-1': {
        ...seedBase()['saleRoundItems/round-item-1'],
        orderedQuantity: 1,
      },
      'checkoutReservations/reservation-round-cancel': {
        id: 'reservation-round-cancel',
        roundId: 'round-1',
        storeId: 'store-1',
        userId: 'user-1',
        orderId: 'order-round-cancel',
        paymentId: 'order-round-cancel',
        status: 'CONSUMED',
        addressKey: 'test',
        deliveryAddressCount: 1,
        itemQuantityTotal: 1,
        items: [{ roundItemId: 'round-item-1', productId: 'product-1', quantity: 1, unitPrice: 50000 }],
        idempotencyKey: 'round-cancel',
        expiresAt: '2099-01-01T00:00:00.000Z',
        consumedAt: '2026-01-01T00:00:00.000Z',
        releasedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    const memory = createInMemoryFirestore(records);
    const firestore = memory.firestore as never;
    const capacity = new OrderCapacityService(firestore);
    const releaseSpy = jest.spyOn(capacity, 'releaseReservation');
    const payments = {
      processRefundByOrderId: jest.fn().mockResolvedValue(undefined),
      refundOrderChargesByOrderId: jest.fn().mockResolvedValue(undefined),
    };
    const settlements = {
      createSettlement: jest.fn().mockResolvedValue(undefined),
      cancelSettlement: jest.fn().mockResolvedValue(undefined),
    };
    const notifications = {
      sendToUser: jest.fn().mockResolvedValue(undefined),
      sendToGroupParticipants: jest.fn().mockResolvedValue(undefined),
    };
    const roundLifecycle = new RoundOrderLifecycleService(
      firestore,
      payments as never,
      settlements as never,
      capacity as never,
    );
    const lifecycle = new OrdersLifecycleService(
      firestore,
      notifications as never,
      payments as never,
      settlements as never,
      capacity as never,
      roundLifecycle,
    );

    await lifecycle.updateStatus(
      'store-1',
      'order-round-cancel',
      'seller-1',
      { status: 'CANCELLED', reason: 'test' } as never,
      'seller',
    );
    // Canonical transaction path used; outside-tx release never called.
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(memory.read('checkoutReservations/reservation-round-cancel')?.status).toBe('RELEASED');
    releaseSpy.mockRestore();

    // Corrupt schemaVersion:2 without roundId fails closed before side effects.
    const corruptMemory = createInMemoryFirestore({
      ...seedBase(),
      'orders/order-corrupt': {
        id: 'order-corrupt',
        storeId: 'store-1',
        userId: 'user-1',
        status: 'ACCEPTED',
        schemaVersion: 2,
        reservationId: 'reservation-x',
      },
    });
    const corruptCapacity = new OrderCapacityService(corruptMemory.firestore as never);
    const corruptRound = new RoundOrderLifecycleService(
      corruptMemory.firestore as never,
      payments as never,
      settlements as never,
      corruptCapacity as never,
    );
    const corruptLifecycle = new OrdersLifecycleService(
      corruptMemory.firestore as never,
      notifications as never,
      payments as never,
      settlements as never,
      corruptCapacity as never,
      corruptRound,
    );
    await expect(
      corruptLifecycle.updateStatus(
        'store-1',
        'order-corrupt',
        'seller-1',
        { status: 'CANCELLED', reason: 'test' } as never,
        'seller',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(payments.processRefundByOrderId).not.toHaveBeenCalledWith(
      'order-corrupt',
      expect.anything(),
    );
  });
});
