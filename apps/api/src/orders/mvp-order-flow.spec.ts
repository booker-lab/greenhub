import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { getAllowedTransitions, NOTIFICATION_MAP } from './orders.helpers';
import { OrdersCreateService } from './orders-create.service';
import { OrdersLifecycleService } from './orders-lifecycle.service';
import { OrdersQueryService } from './orders-query.service';
import { RoundOrderCreateService } from './round-order-create.service';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';

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
    path,
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
  let transactionQueue = Promise.resolve();
  const firestore = {
    doc,
    collection,
    runTransaction: jest.fn((callback: (transaction: any) => Promise<unknown>) => {
      const result = transactionQueue.then(async () => {
        const pending = new Map<string, RecordData>();
        const tx = {
          get: jest.fn(async (ref: { path: string }) =>
            makeSnap(pending.get(ref.path) ?? records.get(ref.path) ?? null),
          ),
          set: jest.fn((ref: { path: string }, data: RecordData, options?: { merge?: boolean }) => {
            if ((ref as { failOrderWrite?: boolean }).failOrderWrite) {
              throw new Error('주문 저장 중단');
            }
            const current = pending.get(ref.path) ?? records.get(ref.path) ?? {};
            pending.set(ref.path, options?.merge ? { ...current, ...data } : data);
          }),
          update: jest.fn((ref: { path: string }, data: RecordData) => {
            const current = pending.get(ref.path) ?? records.get(ref.path) ?? {};
            pending.set(ref.path, { ...current, ...data });
          }),
        };
        const value = await callback(tx);
        for (const [path, data] of pending) {
          writes.push({ op: records.has(path) ? 'update' : 'set', path, data });
          records.set(path, data);
        }
        return value;
      });
      transactionQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }),
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
  const payments = {
    processRefundByOrderId: jest.fn(),
    refundOrderChargesByOrderId: jest.fn(),
  };
  const capacity = {
    releaseReservation: jest.fn(),
    releaseReservationInTransaction: jest.fn(),
  };
  const settlements = {
    createSettlement: jest.fn(),
    cancelSettlement: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function roundOrderRequest(overrides: RecordData = {}) {
    return {
      clientOrderRequestId: 'payment-attempt-1',
      productId: 'product-1',
      quantity: 1,
      saleType: 'normal',
      deliveryMethod: 'direct',
      requestedDeliveryDate: '2026-07-21',
      roundId: 'round-1',
      roundItems: [{ roundItemId: 'round-item-1', quantity: 1 }],
      deliveryPhone: '010-9999-0000',
      deliveryAddress: {
        address: '경기도 이천시 중리천로 1',
        addressDetail: '201호',
        zipCode: '17373',
      },
      ...overrides,
    };
  }

  it('같은 결제 시도 ID와 같은 payload는 주문과 예약 한 건을 반환한다', async () => {
    const { firestore, records } = makeFirestore(seedRoundRecords());
    const capacity = new (require('./order-capacity.service').OrderCapacityService)(firestore);
    const retention = { saveRecord: jest.fn().mockResolvedValue({}) };
    const service = new RoundOrderCreateService(firestore as never, capacity, retention as never);

    const first = await service.create('store-round', 'user-1', roundOrderRequest() as never);
    const second = await service.create('store-round', 'user-1', roundOrderRequest() as never);

    expect(second).toEqual(first);
    expect(Array.from(records.keys()).filter((path) => path.startsWith('orders/'))).toHaveLength(1);
    expect(
      Array.from(records.keys()).filter((path) => path.startsWith('checkoutReservations/')),
    ).toHaveLength(1);
  });

  it('같은 결제 시도 ID에 다른 payload가 들어오면 충돌로 거부한다', async () => {
    const { firestore } = makeFirestore(seedRoundRecords());
    const capacity = new (require('./order-capacity.service').OrderCapacityService)(firestore);
    const service = new RoundOrderCreateService(firestore as never, capacity, {
      saveRecord: jest.fn(),
    } as never);

    await service.create('store-round', 'user-1', roundOrderRequest() as never);
    let error: unknown;
    try {
      await service.create(
        'store-round',
        'user-1',
        roundOrderRequest({
          roundItems: [{ roundItemId: 'round-item-1', quantity: 2 }],
        }) as never,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConflictException);
  });

  it('주문 저장 직전 실패해도 예약과 카운터 부분 데이터가 남지 않는다', async () => {
    const { firestore, records } = makeFirestore(seedRoundRecords());
    const capacity = new (require('./order-capacity.service').OrderCapacityService)(firestore);
    const service = new RoundOrderCreateService(firestore as never, capacity, {
      saveRecord: jest.fn(),
    } as never);
    const originalDoc = firestore.doc;
    firestore.doc = jest.fn((path: string) => {
      const ref = originalDoc(path);
      if (path.startsWith('orders/')) return { ...ref, failOrderWrite: true };
      return ref;
    }) as never;

    await expect(
      service.create('store-round', 'user-1', roundOrderRequest() as never),
    ).rejects.toThrow('주문 저장 중단');
    expect(Array.from(records.keys()).some((path) => path.startsWith('orders/'))).toBe(false);
    expect(
      Array.from(records.keys()).some((path) => path.startsWith('checkoutReservations/')),
    ).toBe(false);
    expect(records.get('saleRounds/round-1')?.['counters']).toMatchObject({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
    });
  });

  it('역할별 기존 전환과 배송 보류 해소 상태를 보존한다', () => {
    expect(getAllowedTransitions('consumer', 'DELIVERED')).toEqual(['REVIEWED']);
    expect(getAllowedTransitions('seller', 'DELIVERY_HELD')).toEqual(['PREPARING', 'CANCELLED']);
    expect(getAllowedTransitions('driver', 'DELIVERY_HELD')).toEqual(['DELIVERING']);
    expect(getAllowedTransitions('admin', 'DELIVERY_HELD')).toEqual([
      'PREPARING',
      'CANCELLED',
      'DELIVERING',
    ]);
  });

  it('배송 보류와 재배송 단계의 거래 알림 전환을 상태표에 연결한다', () => {
    expect(NOTIFICATION_MAP.PREPARING?.DELIVERY_HELD).toBe('ORDER_DELIVERY_HELD');
    expect(NOTIFICATION_MAP.DELIVERING?.DELIVERY_HELD).toBe('ORDER_DELIVERY_HELD');
    expect(NOTIFICATION_MAP.DELIVERY_HELD?.PREPARING).toBe('ORDER_REDELIVERY_PAYMENT_REQUESTED');
    expect(NOTIFICATION_MAP.DELIVERY_HELD?.DELIVERING).toBe('ORDER_REDELIVERY_SCHEDULED');
  });

  function makeLifecycle(firestore: Record<string, unknown>) {
    const roundLifecycle = new RoundOrderLifecycleService(
      firestore as never,
      payments as never,
      settlements as never,
      capacity as never,
    );
    return new OrdersLifecycleService(
      firestore as never,
      notifications as never,
      payments as never,
      settlements as never,
      capacity as never,
      roundLifecycle,
    );
  }

  function makeCreateService(firestore: Record<string, unknown>) {
    const { OrderCapacityService } = require('./order-capacity.service');
    const orderCapacity = new OrderCapacityService(firestore);
    const roundCreate = new RoundOrderCreateService(firestore as never, orderCapacity, {
      saveRecord: jest.fn(),
    } as never);
    return new OrdersCreateService(
      firestore as never,
      notifications as never,
      orderCapacity,
      roundCreate,
    );
  }

  it('round_direct 주문은 이천시 밖 배송 주소를 결제 예약 전에 차단한다', async () => {
    const { firestore } = makeFirestore(seedRoundRecords());
    const service = makeCreateService(firestore);

    await expect(
      service.createOrder('store-round', 'user-1', {
        clientOrderRequestId: 'payment-outside-city',
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
  });

  it('round_direct는 회차 필수값 누락과 중복 roundItemId를 legacy 경로로 우회시키지 않는다', async () => {
    const { firestore } = makeFirestore(seedRoundRecords());
    const service = makeCreateService(firestore);
    const base = {
      clientOrderRequestId: 'payment-invalid-round',
      productId: 'product-1',
      quantity: 1,
      saleType: 'normal',
      deliveryMethod: 'direct',
      requestedDeliveryDate: '2026-07-21',
      deliveryPhone: '010-9999-0000',
      deliveryAddress: { address: '경기도 이천시 중리천로 1', addressDetail: '', zipCode: '17373' },
    };

    await expect(
      service.createOrder('store-round', 'user-1', base as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createOrder('store-round', 'user-1', {
        ...base,
        roundId: 'round-1',
        roundItems: [
          { roundItemId: 'round-item-1', quantity: 1 },
          { roundItemId: 'round-item-1', quantity: 1 },
        ],
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('같은 회차의 여러 상품을 한 주문 스냅샷과 한 번의 결제 금액으로 묶는다', async () => {
    const { firestore, writes } = makeFirestore(seedRoundRecords());
    const service = makeCreateService(firestore);

    const result = await service.createOrder('store-round', 'user-1', {
      clientOrderRequestId: 'payment-multi-item',
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

  it('주문 생성 트랜잭션에 계약 기록과 마케팅 동의 기록을 함께 남긴다', async () => {
    const { firestore } = makeFirestore(seedRoundRecords());
    const { OrderCapacityService } = require('./order-capacity.service');
    const retention = { saveRecord: jest.fn().mockResolvedValue({}) };
    const service = new RoundOrderCreateService(
      firestore as never,
      new OrderCapacityService(firestore),
      retention as never,
    );

    await service.create(
      'store-round',
      'user-1',
      roundOrderRequest({
        marketingConsent: {
          agreed: true,
          channels: ['sms'],
          copyVersion: 'marketing-v1',
          agreedAt: '2026-07-15T03:00:00.000+09:00',
        },
      }) as never,
    );

    expect(retention.saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'LEGAL_ORDER',
        metadata: expect.objectContaining({
          orderId: expect.any(String),
          recordTypes: ['CONTRACT', 'SUPPLY'],
        }),
        transaction: expect.anything(),
      }),
    );
    expect(retention.saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'MARKETING_CONSENT',
        metadata: {
          agreed: true,
          channels: ['sms'],
          orderId: expect.any(String),
          policyVersion: 'marketing-v1',
          recordType: 'CONSENT',
          userId: 'user-1',
        },
        transaction: expect.anything(),
      }),
    );
    expect(JSON.stringify(retention.saveRecord.mock.calls)).not.toMatch(/phone|address/i);
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
      counters: expect.objectContaining({
        reservedDeliveryAddresses: 0,
        reservedItemQuantity: 0,
        orderedDeliveryAddresses: 0,
        orderedItemQuantity: 0,
      }),
    });
  });

  it.each([
    'RELEASED',
    'EXPIRED',
    'CONSUMED',
  ])('%s 예약은 다른 결제 주문이 다시 소비할 수 없다', async (status) => {
    const reservation = {
      id: 'reservation-closed',
      roundId: 'round-1',
      storeId: 'store-round',
      userId: 'user-1',
      orderId: status === 'CONSUMED' ? 'old-order' : null,
      paymentId: null,
      status,
      addressKey: '17373|경기도 이천시 중리천로 1|',
      deliveryAddressCount: 1,
      itemQuantityTotal: 1,
      items: [
        { roundItemId: 'round-item-1', productId: 'product-1', quantity: 1, unitPrice: 50000 },
      ],
      idempotencyKey: 'closed',
      expiresAt: '2026-07-20T00:00:00.000Z',
      consumedAt: null,
      releasedAt: null,
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:00.000Z',
    };
    const { OrderCapacityService } = require('./order-capacity.service');
    const { firestore } = makeFirestore(
      seedRoundRecords({
        'checkoutReservations/reservation-closed': reservation,
      }),
    );
    const service = new OrderCapacityService(firestore);

    await expect(
      service.consumeReservation({
        reservationId: 'reservation-closed',
        orderId: 'new-order',
      }),
    ).rejects.toThrow('이미 닫힌 결제 예약입니다.');
  });

  it('만료 시각이 지난 HELD 예약은 결제 주문이 소비할 수 없다', async () => {
    const { OrderCapacityService } = require('./order-capacity.service');
    const { firestore } = makeFirestore(
      seedRoundRecords({
        'checkoutReservations/reservation-expired': {
          id: 'reservation-expired',
          roundId: 'round-1',
          storeId: 'store-round',
          userId: 'user-1',
          orderId: null,
          paymentId: null,
          status: 'HELD',
          addressKey: 'address',
          deliveryAddressCount: 1,
          itemQuantityTotal: 1,
          items: [
            { roundItemId: 'round-item-1', productId: 'product-1', quantity: 1, unitPrice: 50000 },
          ],
          idempotencyKey: 'expired',
          expiresAt: '2020-01-01T00:00:00.000Z',
          consumedAt: null,
          releasedAt: null,
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
        },
      }),
    );
    const service = new OrderCapacityService(firestore);

    await expect(
      service.consumeReservation({
        reservationId: 'reservation-expired',
        orderId: 'order-1',
      }),
    ).rejects.toThrow('만료된 결제 예약입니다.');
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
    const service = makeLifecycle(firestore);

    await expect(
      (service as any).cancelOrder('store-round', 'order-1', 'user-1', '고객 요청'),
    ).resolves.toMatchObject({ orderId: 'order-1', status: 'CANCELLED' });

    expect(payments.processRefundByOrderId).toHaveBeenCalledWith('order-1', '고객 요청');
    expect(capacity.releaseReservationInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      'reservation-1',
    );
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
    const service = makeLifecycle(firestore);

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
    await service.updateStatus(
      'store-round',
      'order-1',
      'seller-1',
      { status: 'PREPARING' } as never,
      'seller',
    );
    expect(records.get('saleRounds/round-1')).toMatchObject({
      counters: expect.objectContaining({ heldOrderCount: 0 }),
    });
    expect(records.get('orders/order-1')?.['deliveryHold']).toMatchObject({
      resolvedAt: expect.any(String),
    });
  });

  it('같은 배송 보류 요청이 중복 실행돼도 회차 보류 주문 수는 한 번만 증가한다', async () => {
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
    const service = makeLifecycle(firestore);
    const request = {
      status: 'DELIVERY_HELD',
      deliveryHold: {
        reasonCode: 'ACCESS_UNAVAILABLE',
        reasonMessage: '공동현관 출입 불가',
        customerResponsible: false,
      },
    } as never;

    const results = await Promise.allSettled([
      service.updateStatus('store-round', 'order-1', 'seller-1', request, 'seller'),
      service.updateStatus('store-round', 'order-1', 'seller-1', request, 'seller'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(records.get('saleRounds/round-1')).toMatchObject({
      counters: expect.objectContaining({ heldOrderCount: 1 }),
    });
  });

  it('조회 뒤 주문 상태가 바뀐 오래된 전환 요청은 최신 상태 비교로 거부한다', async () => {
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
    const originalRunTransaction = firestore.runTransaction;
    firestore.runTransaction = jest.fn(async (callback) => {
      records.set('orders/order-1', {
        ...records.get('orders/order-1')!,
        status: 'DELIVERING',
      });
      return originalRunTransaction(callback);
    }) as never;
    const service = makeLifecycle(firestore);

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
            customerResponsible: false,
          },
        } as never,
        'seller',
      ),
    ).rejects.toThrow('주문 상태가 변경되었습니다.');
    expect(records.get('saleRounds/round-1')).toMatchObject({
      counters: expect.objectContaining({ heldOrderCount: 0 }),
    });
  });

  it('환불 뒤 로컬 취소 실패는 환불을 반복하지 않는 재시도 상태를 보존한다', async () => {
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
    capacity.releaseReservationInTransaction = jest
      .fn()
      .mockRejectedValueOnce(new Error('예약 반환 실패'))
      .mockResolvedValueOnce(undefined);
    const service = makeLifecycle(firestore);

    await expect(
      service.cancelOrder('store-round', 'order-1', 'user-1', '고객 요청'),
    ).rejects.toThrow('예약 반환 실패');
    expect(records.get('orders/order-1')).toMatchObject({
      status: 'ACCEPTED',
      cancellation: expect.objectContaining({ status: 'LOCAL_FAILED' }),
    });

    await expect(
      service.cancelOrder('store-round', 'order-1', 'user-1', '고객 요청'),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(records.get('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: expect.objectContaining({ status: 'COMPLETED' }),
    });
  });

  it('주문자라도 배송 보류 상태를 만들 수 없다', async () => {
    const { firestore, writes } = makeFirestore(
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
    const service = makeLifecycle(firestore);
    await expect(
      service.updateStatus(
        'store-round',
        'order-1',
        'user-1',
        {
          status: 'DELIVERY_HELD',
          deliveryHold: { reasonCode: 'OTHER', reasonMessage: '위장 요청' },
        } as never,
        'consumer',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes.filter((write) => write.path === 'orders/order-1')).toHaveLength(0);
  });

  it('고객 사유 첫 배송 실패만 재배송비 결제 1회를 만들고 같은 보류의 중복 청구를 막는다', async () => {
    const { OrderChargesService } = require('./order-charges.service');
    const { firestore, records, writes } = makeFirestore(
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
            heldAt: '2026-07-21T01:00:00.000Z',
          },
        },
      }),
    );
    const { OperationsService } = require('../operations/operations.service');
    const operations = new OperationsService(firestore, {}, {});
    const service = new OrderChargesService(firestore, operations);

    const first = await service.createRedeliveryFeeCharge({
      storeId: 'store-round',
      orderId: 'order-1',
      requesterId: 'user-1',
      idempotencyKey: 'redelivery:order-1:first',
    } as never);
    const retried = await service.createRedeliveryFeeCharge({
      storeId: 'store-round',
      orderId: 'order-1',
      requesterId: 'user-1',
      idempotencyKey: 'redelivery:order-1:retry',
    } as never);

    const chargeWrites = writes.filter((write) => write.path.startsWith('orderCharges/'));
    expect(chargeWrites).toHaveLength(1);
    expect(chargeWrites[0].data).toMatchObject({
      type: 'REDELIVERY_FEE',
      amount: 5000,
      attemptNumber: 1,
      customerResponsible: true,
      status: 'PENDING',
      portonePaymentId: expect.stringMatching(/^order-charge-/),
    });
    expect(first).toMatchObject({
      id: chargeWrites[0].data.id,
      portonePaymentParams: {
        paymentId: chargeWrites[0].data.portonePaymentId,
        amount: 5000,
        name: '고객 사유 재배송비',
      },
    });
    expect(retried).toEqual(first);
    expect(records.get('orders/order-1')).toMatchObject({
      redeliveryChargeId: chargeWrites[0].data.id,
      redeliveryChargeHoldAt: '2026-07-21T01:00:00.000Z',
    });
    await expect(
      service.createRedeliveryFeeCharge({
        storeId: 'store-round',
        orderId: 'order-1',
        requesterId: 'user-2',
        idempotencyKey: 'first',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('결제된 재배송비가 있는 주문 취소는 본 결제와 재배송비를 각각 한 번만 환불한다', async () => {
    const { firestore } = makeFirestore(
      seedRoundRecords({
        'orders/order-1': {
          id: 'order-1',
          storeId: 'store-round',
          userId: 'user-1',
          status: 'ACCEPTED',
          schemaVersion: 2,
          roundId: 'round-1',
          reservationId: 'reservation-1',
          redeliveryChargeId: 'charge-1',
          orderItems: [{ roundItemId: 'round-item-1', quantity: 1 }],
        },
        'orderCharges/charge-1': {
          id: 'charge-1',
          orderId: 'order-1',
          storeId: 'store-round',
          userId: 'user-1',
          type: 'REDELIVERY_FEE',
          status: 'PAID',
          amount: 5000,
          portonePaymentId: 'order-charge-charge-1',
        },
      }),
    );
    const service = makeLifecycle(firestore);

    await service.cancelOrder('store-round', 'order-1', 'user-1', '고객 요청');
    await service.cancelOrder('store-round', 'order-1', 'user-1', '고객 요청');

    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(payments.refundOrderChargesByOrderId).toHaveBeenCalledTimes(1);
    expect(payments.refundOrderChargesByOrderId).toHaveBeenCalledWith('order-1', '고객 요청');
  });

  it('재배송비 환불 실패는 주문 취소를 완료하지 않고 재시도 상태를 남긴다', async () => {
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
          redeliveryChargeId: 'charge-1',
          orderItems: [{ roundItemId: 'round-item-1', quantity: 1 }],
        },
      }),
    );
    payments.refundOrderChargesByOrderId.mockRejectedValueOnce(new Error('재배송비 환불 실패'));
    const service = makeLifecycle(firestore);

    await expect(
      service.cancelOrder('store-round', 'order-1', 'user-1', '고객 요청'),
    ).rejects.toThrow('재배송비 환불 실패');

    expect(records.get('orders/order-1')).toMatchObject({
      status: 'ACCEPTED',
      cancellation: expect.objectContaining({ status: 'REFUND_FAILED' }),
    });
  });

  it('고객 사유 재배송 실패는 새 결제 없이 운영 예외 1건으로 전환한다', async () => {
    const { OrderChargesService } = require('./order-charges.service');
    const { firestore, records, writes } = makeFirestore(
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
            heldAt: '2026-07-21T01:00:00.000Z',
          },
        },
      }),
    );
    const { OperationsService } = require('../operations/operations.service');
    const operations = new OperationsService(firestore, {}, {});
    const service = new OrderChargesService(firestore, operations);
    await service.createRedeliveryFeeCharge({
      storeId: 'store-round',
      orderId: 'order-1',
      requesterId: 'user-1',
      idempotencyKey: 'first',
    });
    records.set('orders/order-1', {
      ...records.get('orders/order-1')!,
      deliveryHold: {
        customerResponsible: true,
        redeliveryFee: 5000,
        heldAt: '2026-07-22T01:00:00.000Z',
      },
    });

    const issue = await service.createRedeliveryFeeCharge({
      storeId: 'store-round',
      orderId: 'order-1',
      requesterId: 'user-1',
      idempotencyKey: 'second',
    });
    const retried = await service.createRedeliveryFeeCharge({
      storeId: 'store-round',
      orderId: 'order-1',
      requesterId: 'user-1',
      idempotencyKey: 'second-retry',
    });

    expect(writes.filter((write) => write.path.startsWith('orderCharges/'))).toHaveLength(1);
    expect(
      new Set(
        writes
          .filter((write) => write.path.startsWith('operationIssues/'))
          .map((write) => write.path),
      ).size,
    ).toBe(1);
    expect(issue).toMatchObject({ type: 'REDELIVERY_FAILED', status: 'OPEN' });
    expect(retried).toMatchObject({ id: issue.id });
    expect(records.get('orders/order-1')).toMatchObject({
      requiresOperationalReview: true,
      redeliveryFailureIssueId: issue.id,
    });
  });

  it.each([
    ['판매자 사유', false, 5000],
    ['시스템 사유', false, null],
  ])('%s 배송 실패에는 고객 재배송비를 만들지 않는다', async (_name, customerResponsible, redeliveryFee) => {
    const { OrderChargesService } = require('./order-charges.service');
    const { firestore, writes } = makeFirestore(
      seedRoundRecords({
        'orders/order-1': {
          id: 'order-1',
          storeId: 'store-round',
          userId: 'user-1',
          status: 'DELIVERY_HELD',
          schemaVersion: 2,
          deliveryHold: { customerResponsible, redeliveryFee, heldAt: '2026-07-21T01:00:00.000Z' },
        },
      }),
    );
    const { OperationsService } = require('../operations/operations.service');
    const operations = new OperationsService(firestore, {}, {});
    const service = new OrderChargesService(firestore, operations);

    await expect(
      service.createRedeliveryFeeCharge({
        storeId: 'store-round',
        orderId: 'order-1',
        requesterId: 'user-1',
        idempotencyKey: 'first',
      }),
    ).rejects.toThrow('고객 사유 배송 보류 주문만 재배송비를 만들 수 있습니다.');
    expect(writes.filter((write) => write.path.startsWith('orderCharges/'))).toHaveLength(0);
  });

  it('legacy 주문에는 재배송비 결제 흐름을 적용하지 않는다', async () => {
    const { OrderChargesService } = require('./order-charges.service');
    const { firestore, writes } = makeFirestore(
      seedRoundRecords({
        'orders/order-legacy': {
          id: 'order-legacy',
          storeId: 'store-round',
          userId: 'user-1',
          status: 'DELIVERY_HELD',
          deliveryHold: {
            customerResponsible: true,
            redeliveryFee: 5000,
            heldAt: '2026-07-21T01:00:00.000Z',
          },
        },
      }),
    );
    const { OperationsService } = require('../operations/operations.service');
    const operations = new OperationsService(firestore, {}, {});
    const service = new OrderChargesService(firestore, operations);

    await expect(
      service.createRedeliveryFeeCharge({
        storeId: 'store-round',
        orderId: 'order-legacy',
        requesterId: 'user-1',
        idempotencyKey: 'first',
      }),
    ).rejects.toThrow('고객 사유 배송 보류 주문만 재배송비를 만들 수 있습니다.');
    expect(writes.filter((write) => write.path.startsWith('orderCharges/'))).toHaveLength(0);
  });

  it('기존 lineAmount와 신규 주문 상품 금액을 subtotalAmount로 통일한다', async () => {
    const { firestore } = makeFirestore(
      seedRoundRecords({
        'orders/order-legacy': {
          id: 'order-legacy',
          storeId: 'store-round',
          userId: 'user-1',
          status: 'ACCEPTED',
          orderItems: [
            {
              productId: 'product-1',
              productName: '호접란',
              unitPrice: 50000,
              quantity: 2,
              lineAmount: 100000,
            },
          ],
        },
      }),
    );
    const result = await new OrdersQueryService(firestore as never).getOrder(
      'store-round',
      'order-legacy',
      'user-1',
    );
    expect(result.orderItems[0]).toMatchObject({ subtotalAmount: 100000 });
    expect(result.orderItems[0]).not.toHaveProperty('lineAmount');
  });
});
