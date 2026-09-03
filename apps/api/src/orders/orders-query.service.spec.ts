import { ForbiddenException } from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { OrdersQueryService } from './orders-query.service';

type RecordMap = Record<string, Record<string, unknown>>;

function makeFirestore(records: RecordMap) {
  const makeQuery = (filters: Array<[string, unknown]> = []) => ({
    where: jest.fn((field: string, _operator: string, value: unknown) =>
      makeQuery([...filters, [field, value]]),
    ),
    orderBy: jest.fn().mockReturnThis(),
    get: jest.fn(async () => {
      const docs = Object.entries(records)
        .filter(([path]) => path.startsWith('orders/'))
        .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
        .map(([path, data]) => ({
          id: path.split('/')[1],
          data: () => data,
        }));
      return { docs };
    }),
  });

  return {
    doc: jest.fn((path: string) => ({
      get: jest.fn(async () => ({
        exists: path in records,
        data: () => records[path],
      })),
    })),
    collection: jest.fn(() => makeQuery()),
  };
}

const requester = (sub: string, role: JwtPayload['role']): JwtPayload => ({ sub, role });

describe('OrdersQueryService 조회 권한', () => {
  const records: RecordMap = {
    'stores/store-1': { ownerId: 'seller-1' },
    'stores/store-2': { ownerId: 'seller-2' },
    'orders/order-1': {
      id: 'order-1',
      storeId: 'store-1',
      userId: 'consumer-1',
      driverId: 'driver-1',
      totalAmount: 10000,
      quantity: 1,
    },
    'orders/order-2': {
      id: 'order-2',
      storeId: 'store-1',
      userId: 'consumer-2',
      driverId: 'driver-2',
      totalAmount: 20000,
      quantity: 1,
    },
    'orders/order-3': {
      id: 'order-3',
      storeId: 'store-2',
      userId: 'consumer-1',
      driverId: 'driver-1',
      totalAmount: 30000,
      quantity: 1,
    },
  };

  it('소비자는 매장 주문 목록 API를 사용할 수 없다', async () => {
    const service = new OrdersQueryService(makeFirestore(records) as never);

    await expect(
      service.getOrders('store-1', requester('consumer-1', 'consumer'), {
        userId: 'consumer-2',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('소비자는 다른 소비자의 주문 상세를 조회할 수 없다', async () => {
    const service = new OrdersQueryService(makeFirestore(records) as never);

    await expect(
      service.getOrder('store-1', 'order-2', requester('consumer-1', 'consumer')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('판매자는 실제 소유하지 않은 스토어의 주문 목록과 상세를 조회할 수 없다', async () => {
    const service = new OrdersQueryService(makeFirestore(records) as never);
    const seller = requester('seller-1', 'seller');

    await expect(service.getOrders('store-2', seller, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.getOrder('store-2', 'order-3', seller)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('기사는 매장 주문 목록·상세 API를 사용할 수 없다', async () => {
    const service = new OrdersQueryService(makeFirestore(records) as never);
    const driver = requester('driver-1', 'driver');

    await expect(service.getOrders('store-1', driver, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.getOrder('store-1', 'order-2', driver)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('판매자 자기 매장 주문만 목록·상세에서 운영 필드 투영으로 조회한다', async () => {
    const sellerOrder = {
      id: 'seller-order',
      storeId: 'store-1',
      userId: 'consumer-1',
      driverId: 'driver-1',
      orderNumber: '20260830-000001',
      productId: 'product-1',
      productName: '호접란',
      quantity: 2,
      saleType: 'normal',
      status: 'PREPARING',
      deliveryMethod: 'direct',
      deliveryFee: 3000,
      totalAmount: 23000,
      requestedDeliveryDate: '2026-08-31',
      preparedAt: '2026-08-30T05:00:00.000Z',
      pickupCode: null,
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T01:00:00.000Z',
      deliveryAddress: {
        address: '서울시 중구 세종대로 1',
        addressDetail: '101호',
        zipCode: '04524',
        internalAddressToken: 'hidden-address-token',
      },
      isMetropolitan: true,
      hubId: null,
      cancelReason: null,
      buyerName: '구매자',
      deliveryPhone: '010-1111-1111',
      buyerPhone: '010-2222-2222',
      deliveryHold: {
        heldAt: '2026-08-29T00:00:00.000Z',
        reasonCode: 'ACCESS_UNAVAILABLE',
        reasonMessage: '출입 불가',
        customerResponsible: false,
        redeliveryFee: null,
        nextContactAt: '2026-08-30T02:00:00.000Z',
        nextDeliveryAt: '2026-08-31T02:00:00.000Z',
        resolvedAt: null,
        internalHoldToken: 'hidden-hold-token',
      },
      orderItems: [
        {
          roundItemId: null,
          productId: 'product-1',
          productName: '호접란',
          productImageUrl: null,
          unitPrice: 10000,
          quantity: 2,
          subtotalAmount: 20000,
          lineAmount: 20000,
          internalItemCost: 4000,
        },
      ],
      reservationId: 'reservation-1',
      clientOrderPayloadHash: 'payload-hash',
      marketingConsent: { agreed: true },
      acquisition: { source: 'direct' },
      deliveryPhotoIds: ['photo-1'],
      redeliveryChargeId: 'charge-1',
    };
    const service = new OrdersQueryService(
      makeFirestore({
        'stores/store-1': { ownerId: 'seller-1' },
        'orders/seller-order': sellerOrder,
      }) as never,
    );
    const seller = requester('seller-1', 'seller');

    const list = await service.getOrders('store-1', seller, {});
    const detail = await service.getOrder('store-1', 'seller-order', seller);

    expect(list[0]).toMatchObject({
      id: 'seller-order',
      storeId: 'store-1',
      orderNumber: '20260830-000001',
      productName: '호접란',
      status: 'PREPARING',
      totalAmount: 23000,
    });
    expect(list[0]).not.toHaveProperty('userId');
    expect(list[0]).not.toHaveProperty('driverId');
    expect(list[0]).not.toHaveProperty('orderItems');
    expect(list[0]).not.toHaveProperty('marketingConsent');
    expect(list[0]).not.toHaveProperty('acquisition');
    expect(list[0]).not.toHaveProperty('redeliveryChargeId');

    expect(detail).toMatchObject({
      id: 'seller-order',
      deliveryAddress: {
        address: '서울시 중구 세종대로 1',
        addressDetail: '101호',
        zipCode: '04524',
      },
      buyerName: '구매자',
      deliveryPhone: '010-1111-1111',
      orderItems: [
        {
          productId: 'product-1',
          productName: '호접란',
          unitPrice: 10000,
          quantity: 2,
          subtotalAmount: 20000,
        },
      ],
      deliveryHold: {
        reasonCode: 'ACCESS_UNAVAILABLE',
        reasonMessage: '출입 불가',
        customerResponsible: false,
        redeliveryFee: null,
        nextContactAt: '2026-08-30T02:00:00.000Z',
        nextDeliveryAt: '2026-08-31T02:00:00.000Z',
        resolvedAt: null,
      },
    });
    expect(detail.redeliveryPayment).toEqual(
      expect.objectContaining({ required: false, status: 'NOT_REQUIRED' }),
    );
    for (const field of [
      'userId',
      'driverId',
      'reservationId',
      'clientOrderPayloadHash',
      'marketingConsent',
      'acquisition',
      'deliveryPhotoIds',
      'redeliveryChargeId',
      'buyerPhone',
    ]) {
      expect(detail).not.toHaveProperty(field);
    }
    expect(detail.deliveryAddress).not.toHaveProperty('internalAddressToken');
    expect(detail.deliveryHold).not.toHaveProperty('internalHoldToken');
    expect(detail.orderItems[0]).not.toHaveProperty('lineAmount');
    expect(detail.orderItems[0]).not.toHaveProperty('internalItemCost');
    expect(detail.redeliveryPayment).not.toHaveProperty('chargeId');
  });

  it('admin은 기존처럼 스토어 주문 전체를 조회할 수 있다', async () => {
    const service = new OrdersQueryService(makeFirestore(records) as never);

    const result = await service.getOrders('store-1', requester('admin-1', 'admin'), {});

    expect(result.map((order) => order.id)).toEqual(['order-1', 'order-2']);
  });

  it('storeId 없는 상세 조회도 판매자 소유권과 기사 배정을 검증한다', async () => {
    const service = new OrdersQueryService(makeFirestore(records) as never);

    await expect(
      service.getOrderById('order-3', requester('seller-1', 'seller')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.getOrderById('order-2', requester('driver-1', 'driver')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('공유 GET의 Driver 읽기도 assigned-self만으로 Pilot structural contract를 우회할 수 없다', async () => {
    const pilotRecords: RecordMap = {
      'users/driver-1': { id: 'driver-1', role: 'driver', driverApproved: true },
      'stores/pilot': { id: 'pilot', salesMode: 'round_direct' },
      'saleRounds/round-valid': { id: 'round-valid', storeId: 'pilot' },
      'saleRounds/round-foreign': { id: 'round-foreign', storeId: 'other-store' },
      'orders/pilot-assigned': {
        id: 'pilot-assigned',
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-valid',
        deliveryMethod: 'direct',
        status: 'DELIVERING',
        driverId: 'driver-1',
        totalAmount: 10000,
        quantity: 1,
      },
      'orders/pilot-missing-round': {
        id: 'pilot-missing-round',
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-missing',
        deliveryMethod: 'direct',
        status: 'DELIVERING',
        driverId: 'driver-1',
        totalAmount: 10000,
        quantity: 1,
      },
      'orders/pilot-foreign-round': {
        id: 'pilot-foreign-round',
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-foreign',
        deliveryMethod: 'direct',
        status: 'DELIVERING',
        driverId: 'driver-1',
        totalAmount: 10000,
        quantity: 1,
      },
    };
    const service = new OrdersQueryService(makeFirestore(pilotRecords) as never);
    const driver = requester('driver-1', 'driver');

    await expect(service.getOrderById('pilot-assigned', driver)).resolves.toMatchObject({
      id: 'pilot-assigned',
      status: 'DELIVERING',
    });
    await expect(service.getOrderById('pilot-missing-round', driver)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.getOrderById('pilot-foreign-round', driver)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each([
    'DELIVERED',
    'REVIEWED',
  ])('%s 단건 상세은 권한 확인 뒤 첫 연결 사진의 15분 서명 URL을 반환한다', async (status) => {
    const completedRecords: RecordMap = {
      ...records,
      'orders/order-completed': {
        id: 'order-completed',
        storeId: 'store-1',
        userId: 'consumer-1',
        driverId: 'driver-1',
        schemaVersion: 2,
        roundId: 'round-1',
        deliveryMethod: 'direct',
        status,
        deliveryPhotoIds: ['photo-first', 'photo-second'],
        totalAmount: 10000,
        quantity: 1,
      },
    };
    const storage = {
      createDeliveryPhotoReadUrl: jest.fn().mockResolvedValue({
        url: 'https://signed.example.invalid/photo-first',
        expiresAt: '2026-07-18T03:15:00.000Z',
      }),
    };
    const service = new OrdersQueryService(
      makeFirestore(completedRecords) as never,
      storage as never,
    );

    await expect(
      service.getOrderById('order-completed', requester('consumer-1', 'consumer')),
    ).resolves.toMatchObject({
      id: 'order-completed',
      deliveryPhotoUrl: 'https://signed.example.invalid/photo-first',
    });
    expect(storage.createDeliveryPhotoReadUrl).toHaveBeenCalledWith({
      storeId: 'store-1',
      orderId: 'order-completed',
      photoId: 'photo-first',
      requesterId: 'consumer-1',
      requesterRole: 'consumer',
    });
  });

  it('목록과 미완료 상세은 사진 ID가 있어도 서명 URL을 생성하지 않는다', async () => {
    const photoRecords: RecordMap = {
      ...records,
      'orders/order-1': {
        ...records['orders/order-1'],
        schemaVersion: 2,
        roundId: 'round-1',
        deliveryMethod: 'direct',
        status: 'DELIVERING',
        deliveryPhotoIds: ['photo-first'],
      },
    };
    const storage = {
      createDeliveryPhotoReadUrl: jest.fn().mockResolvedValue({
        url: 'https://signed.example.invalid/photo-first',
        expiresAt: '2026-07-18T03:15:00.000Z',
      }),
    };
    const service = new OrdersQueryService(makeFirestore(photoRecords) as never, storage as never);

    const list = await service.getMyOrders('consumer-1');
    const detail = await service.getOrderById('order-1', requester('consumer-1', 'consumer'));

    expect(list[0]).not.toHaveProperty('deliveryPhotoUrl');
    expect(detail).not.toHaveProperty('deliveryPhotoUrl');
    expect(storage.createDeliveryPhotoReadUrl).not.toHaveBeenCalled();
  });

  it('서명 URL 생성 실패를 공개 URL이나 원본 경로로 우회하지 않는다', async () => {
    const completedRecords: RecordMap = {
      ...records,
      'orders/order-completed': {
        id: 'order-completed',
        storeId: 'store-1',
        userId: 'consumer-1',
        schemaVersion: 2,
        roundId: 'round-1',
        deliveryMethod: 'direct',
        status: 'DELIVERED',
        deliveryPhotoIds: ['photo-first'],
        totalAmount: 10000,
        quantity: 1,
      },
    };
    const storage = {
      createDeliveryPhotoReadUrl: jest.fn().mockRejectedValue(new Error('서명 실패')),
    };
    const service = new OrdersQueryService(
      makeFirestore(completedRecords) as never,
      storage as never,
    );

    await expect(
      service.getOrderById('order-completed', requester('consumer-1', 'consumer')),
    ).rejects.toThrow('서명 실패');
  });

  it.each([
    ['PENDING', { canPay: true, paid: false, requiresRecovery: false }],
    ['PAID', { canPay: false, paid: true, requiresRecovery: false }],
    ['FAILED', { canPay: false, paid: false, requiresRecovery: true }],
  ] as const)('%s current charge의 semantic을 그대로 제공한다', async (chargeStatus, expected) => {
    const holdAt = '2026-08-26T00:00:00.000Z';
    const paymentRecords: RecordMap = {
      'orders/payment-order': {
        id: 'payment-order',
        storeId: 'store-1',
        userId: 'consumer-1',
        driverId: 'driver-1',
        status: 'PREPARING',
        totalAmount: 10000,
        quantity: 1,
        deliveryHold: {
          heldAt: holdAt,
          customerResponsible: true,
          redeliveryFee: 5000,
          resolvedAt: null,
        },
        redeliveryChargeId: 'charge-1',
        redeliveryChargeHoldAt: holdAt,
      },
      'orderCharges/charge-1': {
        id: 'charge-1',
        orderId: 'payment-order',
        storeId: 'store-1',
        userId: 'consumer-1',
        type: 'REDELIVERY_FEE',
        customerResponsible: true,
        holdAt,
        amount: 5000,
        portonePaymentId: 'payment-charge-1',
        status: chargeStatus,
      },
    };
    const service = new OrdersQueryService(makeFirestore(paymentRecords) as never);

    const result = await service.getOrderById('payment-order', requester('consumer-1', 'consumer'));

    expect(result.redeliveryPayment).toEqual(
      expect.objectContaining({
        required: true,
        holdAt,
        chargeId: 'charge-1',
        status: chargeStatus,
        ...expected,
      }),
    );
    expect(Object.keys(result.redeliveryPayment!).sort()).toEqual(
      ['required', 'holdAt', 'chargeId', 'status', 'canPay', 'paid', 'requiresRecovery'].sort(),
    );
  });
});
