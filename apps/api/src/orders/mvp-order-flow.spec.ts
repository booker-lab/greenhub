import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrdersCreateService } from './orders-create.service';
import { OrdersLifecycleService } from './orders-lifecycle.service';
import { OrdersQueryService } from './orders-query.service';

type RecordData = Record<string, unknown>;
function makeSnap(data: RecordData | null) {
  return {
    exists: data !== null,
    data: () => data,
    id: data?.['id'],
  };
}
function makeFirestore(initial: Record<string, RecordData>) {
  const records = new Map<string, RecordData>(Object.entries(initial));
  const writes: Array<{ op: string; path: string; data: RecordData }> = [];

  const doc = (path: string) => ({
    get: jest.fn(async () => makeSnap(records.get(path) ?? null)),
    set: jest.fn(async (data: RecordData) => {
      writes.push({ op: 'set', path, data });
      records.set(path, { ...(records.get(path) ?? {}), ...data });
    }),
    update: jest.fn(async (data: RecordData) => {
      writes.push({ op: 'update', path, data });
      records.set(path, { ...(records.get(path) ?? {}), ...data });
    }),
  });
  const collection = (name: string) => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      where(field: string, _op: string, value: unknown) {
        filters.push([field, value]);
        return query;
      },
      async get() {
        const docs = Array.from(records.entries())
          .filter(([path]) => path.startsWith(`${name}/`))
          .map(([path, data]) => ({ id: path.split('/')[1], data: () => data }))
          .filter((snap) => filters.every(([field, value]) => snap.data()[field] === value));
        return { docs };
      },
      doc(id: string) {
        return doc(`${name}/${id}`);
      },
    };
    return query;
  };
  const tx = {
    get: jest.fn(async (ref: { get: () => Promise<unknown> }) => ref.get()),
    set: jest.fn((ref: { set: (data: RecordData) => Promise<void> }, data: RecordData) =>
      ref.set(data),
    ),
    update: jest.fn((ref: { update: (data: RecordData) => Promise<void> }, data: RecordData) =>
      ref.update(data),
    ),
  };
  const firestore = {
    doc,
    collection,
    runTransaction: jest.fn(async (callback: (transaction: typeof tx) => Promise<void>) =>
      callback(tx),
    ),
    Timestamp: {
      now: jest.fn(() => new Date('2026-07-15T03:00:00.000+09:00')),
      fromDate: jest.fn((date: Date) => date),
    },
    FieldValue: {
      increment: jest.fn((value: number) => ({ __increment: value })),
    },
  };

  return { firestore, records, writes };
}

function seedRoundRecords(overrides: Record<string, RecordData> = {}) {
  return {
    'stores/store-round': {
      id: 'store-round',
      salesMode: 'round_direct',
      ownerId: 'seller-1',
      phone: '010-1111-2222',
    },
    'users/user-1': {
      id: 'user-1',
      name: '고객',
      email: 'buyer@example.com',
      phone: '010-3333-4444',
    },
    'products/product-1': {
      id: 'product-1',
      storeId: 'store-round',
      name: '미니 호접란',
      price: 50000,
      deliverySize: 'small',
      imageUrl: 'https://example.com/mini.jpg',
    },
    'products/product-2': {
      id: 'product-2',
      storeId: 'store-round',
      name: '대형 호접란',
      price: 80000,
      deliverySize: 'large',
      imageUrl: 'https://example.com/large.jpg',
    },
    'saleRounds/round-1': {
      id: 'round-1',
      storeId: 'store-round',
      name: '7월 3주차',
      status: 'OPEN',
      schedule: {
        orderCloseAt: '2026-07-20T00:00:00.000+09:00',
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
      storeId: 'store-round',
      productId: 'product-1',
      productNameSnapshot: '미니 호접란',
      productImageUrlSnapshot: 'https://example.com/mini.jpg',
      roundPrice: 50000,
      saleLimitQuantity: 20,
      reservedQuantity: 0,
      orderedQuantity: 0,
      status: 'ACTIVE',
    },
    'saleRoundItems/round-item-2': {
      id: 'round-item-2',
      roundId: 'round-1',
      storeId: 'store-round',
      productId: 'product-2',
      productNameSnapshot: '대형 호접란',
      productImageUrlSnapshot: 'https://example.com/large.jpg',
      roundPrice: 80000,
      saleLimitQuantity: 10,
      reservedQuantity: 0,
      orderedQuantity: 0,
      status: 'ACTIVE',
    },
    'dailyCaps/store-round_2026-07-21': {
      id: 'store-round_2026-07-21',
      storeId: 'store-round',
      date: '2026-07-21',
      totalCap: 15,
      usedSlots: 0,
    },
    ...overrides,
  };
}

describe('MVP 회차 주문 흐름 계약', () => {
  const notifications = {
    sendToUser: jest.fn(),
    sendToGroupParticipants: jest.fn(),
    processGroupBuyEarlyConfirm: jest.fn(),
  };
  const payments = { processRefundByOrderId: jest.fn() };
  const capacity = { releaseReservation: jest.fn() };
  const settlements = {
    createSettlement: jest.fn(),
    cancelSettlement: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('round_direct 주문은 이천시 밖 배송 주소를 결제 예약 전에 차단한다', async () => {
    const { firestore } = makeFirestore(seedRoundRecords());
    const capacity = { reserveCheckout: jest.fn() };
    const service = new OrdersCreateService(
      firestore as never,
      notifications as never,
      capacity as never,
    );

    await expect(
      service.createOrder('store-round', 'user-1', {
        productId: 'product-1',
        quantity: 1,
        saleType: 'normal',
        deliveryMethod: 'direct',
        requestedDeliveryDate: '2026-07-21',
        roundId: 'round-1',
        roundItems: [{ roundItemId: 'round-item-1', quantity: 1 }],
        deliveryPhone: '010-9999-0000',
        deliveryAddress: {
          address: '서울특별시 강남구 이천시로 1',
          addressDetail: '101호',
          zipCode: '06234',
        },
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(capacity.reserveCheckout).not.toHaveBeenCalled();
  });

  it('round_direct는 회차 필수값 누락과 중복 roundItemId를 legacy 경로로 우회시키지 않는다', async () => {
    const { firestore } = makeFirestore(seedRoundRecords());
    const capacity = { reserveCheckout: jest.fn() };
    const service = new OrdersCreateService(firestore as never, notifications as never, capacity as never);
    const base = {
      productId: 'product-1', quantity: 1, saleType: 'normal', deliveryMethod: 'direct',
      requestedDeliveryDate: '2026-07-21', deliveryPhone: '010-9999-0000',
      deliveryAddress: { address: '경기도 이천시 중리천로 1', addressDetail: '', zipCode: '17373' },
    };

    await expect(service.createOrder('store-round', 'user-1', base as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createOrder('store-round', 'user-1', {
      ...base, roundId: 'round-1', roundItems: [
        { roundItemId: 'round-item-1', quantity: 1 },
        { roundItemId: 'round-item-1', quantity: 1 },
      ],
    } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(capacity.reserveCheckout).not.toHaveBeenCalled();
  });

  it('같은 회차의 여러 상품을 한 주문 스냅샷과 한 번의 결제 금액으로 묶는다', async () => {
    const reservation = { id: 'reservation-1', expiresAt: '2026-07-15T03:15:00.000+09:00' };
    const capacity = { reserveCheckout: jest.fn().mockResolvedValue(reservation) };
    const { firestore, writes } = makeFirestore(seedRoundRecords());
    const service = new OrdersCreateService(
      firestore as never,
      notifications as never,
      capacity as never,
    );

    const result = await service.createOrder('store-round', 'user-1', {
      productId: 'product-1',
      quantity: 1,
      saleType: 'normal',
      deliveryMethod: 'direct',
      requestedDeliveryDate: '2026-07-21',
      roundId: 'round-1',
      roundItems: [
        { roundItemId: 'round-item-1', quantity: 1 },
        { roundItemId: 'round-item-2', quantity: 1 },
      ],
      deliveryPhone: '010-9999-0000',
      deliveryAddress: {
        address: '경기도 이천시 중리천로 1',
        addressDetail: '201호',
        zipCode: '17373',
      },
      acquisition: {
        source: 'carrot',
        campaign: 'july-round',
        content: 'feed',
        landingUrl: 'https://greenlove.co.kr/products/product-1?round=round-1',
        capturedAt: '2026-07-15T03:00:00.000+09:00',
      },
    } as never);

    const orderWrite = writes.find((write) => write.path.startsWith('orders/'))?.data;
    expect(result.portonePaymentParams.amount).toBe(130000);
    expect(orderWrite).toMatchObject({
      schemaVersion: 2,
      roundId: 'round-1',
      deliveryPhone: '010-9999-0000',
      totalAmount: 130000,
      acquisition: expect.objectContaining({ source: 'carrot' }),
    });
    expect(orderWrite?.['orderItems']).toHaveLength(2);
    expect((orderWrite?.['orderItems'] as RecordData[])[0]).toHaveProperty('subtotalAmount', 50000);
    expect((orderWrite?.['orderItems'] as RecordData[])[0]).not.toHaveProperty('lineAmount');
  });

  it('주문 저장 실패 시 이미 확보한 예약을 즉시 반환한다', async () => {
    const reservation = {
      id: 'reservation-1', expiresAt: '2026-07-15T03:15:00.000+09:00', itemQuantityTotal: 1,
      items: [{ roundItemId: 'round-item-1', productId: 'product-1', quantity: 1, unitPrice: 50000 }],
    };
    const capacity = {
      reserveCheckout: jest.fn().mockResolvedValue(reservation),
      releaseReservation: jest.fn().mockResolvedValue(undefined),
    };
    const { firestore } = makeFirestore(seedRoundRecords());
    firestore.runTransaction = jest.fn().mockRejectedValue(new Error('저장 실패')) as never;
    const service = new OrdersCreateService(firestore as never, notifications as never, capacity as never);

    await expect(service.createOrder('store-round', 'user-1', {
      productId: 'product-1', quantity: 1, saleType: 'normal', deliveryMethod: 'direct',
      requestedDeliveryDate: '2026-07-21', roundId: 'round-1',
      roundItems: [{ roundItemId: 'round-item-1', quantity: 1 }], deliveryPhone: '010-9999-0000',
      deliveryAddress: { address: '경기도 이천시 중리천로 1', addressDetail: '', zipCode: '17373' },
    } as never)).rejects.toThrow('저장 실패');
    expect(capacity.releaseReservation).toHaveBeenCalledWith('reservation-1');
  });

  it('결제 예약은 배송지 1건과 주문 상품 수량 합계를 15분간 확보한다', async () => {
    const { OrderCapacityService } = require('./order-capacity.service');
    const { firestore, records } = makeFirestore(seedRoundRecords());
    const service = new OrderCapacityService(firestore);

    const reservation = await service.reserveCheckout({
      storeId: 'store-round',
      roundId: 'round-1',
      userId: 'user-1',
      idempotencyKey: 'checkout-1',
      deliveryAddress: {
        address: '경기도 이천시 중리천로 1',
        addressDetail: '201호',
        zipCode: '17373',
      },
      items: [
        { roundItemId: 'round-item-1', quantity: 2 },
        { roundItemId: 'round-item-2', quantity: 1 },
      ],
    });
    expect(reservation).toMatchObject({
      status: 'HELD',
      deliveryAddressCount: 1,
      itemQuantityTotal: 3,
    });
    expect(records.get('saleRounds/round-1')).toMatchObject({
      counters: expect.objectContaining({
        reservedDeliveryAddresses: 1,
        reservedItemQuantity: 3,
      }),
    });
    await service.consumeReservation({ reservationId: reservation.id, orderId: 'order-1' });
    await service.releaseReservation(reservation.id);
    await service.releaseReservation(reservation.id);
    expect(records.get('saleRounds/round-1')).toMatchObject({
      counters: expect.objectContaining({ reservedDeliveryAddresses: 0, reservedItemQuantity: 0, orderedDeliveryAddresses: 0, orderedItemQuantity: 0 }),
    });
  });

  it('마감 전 고객 취소는 결제 환불과 회차 예약·주문 한도 반환을 함께 수행한다', async () => {
    const { firestore, records } = makeFirestore(
      seedRoundRecords({
        'orders/order-1': {
          id: 'order-1',
          storeId: 'store-round',
          userId: 'user-1',
          status: 'ACCEPTED',
          schemaVersion: 2,
          roundId: 'round-1',
          reservationId: 'reservation-1',
          orderItems: [{ roundItemId: 'round-item-1', quantity: 2 }],
        },
      }),
    );
    const service = new OrdersLifecycleService(
      firestore as never,
      notifications as never,
      payments as never,
      settlements as never,
      capacity as never,
    );

    await expect(
      (service as any).cancelOrder('store-round', 'order-1', 'user-1', '고객 요청'),
    ).resolves.toMatchObject({ orderId: 'order-1', status: 'CANCELLED' });

    expect(payments.processRefundByOrderId).toHaveBeenCalledWith('order-1', '고객 요청');
    expect(capacity.releaseReservation).toHaveBeenCalledWith('reservation-1');
    expect(records.get('saleRounds/round-1')).toMatchObject({
      counters: expect.objectContaining({
        orderedDeliveryAddresses: 0,
        orderedItemQuantity: 0,
      }),
    });
  });

  it('배송 보류 전환은 보류 스냅샷과 회차 보류 주문 수를 기록한다', async () => {
    const { firestore, records } = makeFirestore(
      seedRoundRecords({
        'orders/order-1': {
          id: 'order-1',
          storeId: 'store-round',
          userId: 'user-1',
          status: 'PREPARING',
          schemaVersion: 2,
          roundId: 'round-1',
          deliveryMethod: 'direct',
        },
      }),
    );
    const service = new OrdersLifecycleService(
      firestore as never,
      notifications as never,
      payments as never,
      settlements as never,
      capacity as never,
    );

    await expect(
      service.updateStatus(
        'store-round',
        'order-1',
        'seller-1',
        {
          status: 'DELIVERY_HELD',
          deliveryHold: {
            reasonCode: 'ACCESS_UNAVAILABLE',
            reasonMessage: '공동현관 출입 불가',
            customerResponsible: true,
            redeliveryFee: 5000,
            nextContactAt: '2026-07-22T09:00:00.000+09:00',
          },
        } as never,
        'seller',
      ),
    ).resolves.toMatchObject({ orderId: 'order-1', status: 'DELIVERY_HELD' });

    expect(records.get('orders/order-1')).toMatchObject({
      status: 'DELIVERY_HELD',
      deliveryHold: expect.objectContaining({ customerResponsible: true }),
    });
    expect(records.get('saleRounds/round-1')).toMatchObject({
      counters: expect.objectContaining({ heldOrderCount: 1 }),
    });
    await service.updateStatus('store-round', 'order-1', 'seller-1', { status: 'PREPARING' } as never, 'seller');
    expect(records.get('saleRounds/round-1')).toMatchObject({
      counters: expect.objectContaining({ heldOrderCount: 0 }),
    });
    expect(records.get('orders/order-1')?.['deliveryHold']).toMatchObject({ resolvedAt: expect.any(String) });
  });

  it('주문자라도 배송 보류 상태를 만들 수 없다', async () => {
    const { firestore, writes } = makeFirestore(seedRoundRecords({
      'orders/order-1': { id: 'order-1', storeId: 'store-round', userId: 'user-1', status: 'PREPARING', schemaVersion: 2, roundId: 'round-1', deliveryMethod: 'direct' },
    }));
    const service = new OrdersLifecycleService(firestore as never, notifications as never, payments as never, settlements as never, capacity as never);
    await expect(service.updateStatus('store-round', 'order-1', 'user-1', {
      status: 'DELIVERY_HELD', deliveryHold: { reasonCode: 'OTHER', reasonMessage: '위장 요청' },
    } as never, 'consumer')).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes.filter((write) => write.path === 'orders/order-1')).toHaveLength(0);
  });

  it('고객 사유 첫 배송 실패만 재배송비 결제 1회를 만들고 중복 청구를 막는다', async () => {
    const { OrderChargesService } = require('./order-charges.service');
    const { firestore, writes } = makeFirestore(
      seedRoundRecords({
        'orders/order-1': {
          id: 'order-1',
          storeId: 'store-round',
          userId: 'user-1',
          status: 'DELIVERY_HELD',
          schemaVersion: 2,
          deliveryHold: {
            customerResponsible: true,
            redeliveryFee: 5000,
          },
        },
      }),
    );
    const service = new OrderChargesService(firestore);

    await service.createRedeliveryFeeCharge({
      storeId: 'store-round',
      orderId: 'order-1',
      requesterId: 'user-1',
      idempotencyKey: 'redelivery:order-1:first',
    } as never);
    await service.createRedeliveryFeeCharge({
      storeId: 'store-round',
      orderId: 'order-1',
      requesterId: 'user-1',
      idempotencyKey: 'redelivery:order-1:first',
    } as never);

    const chargeWrites = writes.filter((write) => write.path.startsWith('orderCharges/'));
    expect(chargeWrites).toHaveLength(1);
    expect(chargeWrites[0].data).toMatchObject({
      type: 'REDELIVERY_FEE',
      amount: 5000,
      attemptNumber: 1,
      customerResponsible: true,
      status: 'PENDING',
    });
    await expect(service.createRedeliveryFeeCharge({
      storeId: 'store-round', orderId: 'order-1', requesterId: 'user-2', idempotencyKey: 'first',
    } as never)).rejects.toBeInstanceOf(ForbiddenException);
    });
  it('기존 lineAmount와 신규 주문 상품 금액을 subtotalAmount로 통일한다', async () => {
    const { firestore } = makeFirestore(seedRoundRecords({
      'orders/order-legacy': {
        id: 'order-legacy', storeId: 'store-round', userId: 'user-1', status: 'ACCEPTED',
        orderItems: [{ productId: 'product-1', productName: '호접란', unitPrice: 50000, quantity: 2, lineAmount: 100000 }],
      },
    }));
    const result = await new OrdersQueryService(firestore as never).getOrder('store-round', 'order-legacy', 'user-1');
    expect(result.orderItems[0]).toMatchObject({ subtotalAmount: 100000 });
    expect(result.orderItems[0]).not.toHaveProperty('lineAmount');
  });
});
