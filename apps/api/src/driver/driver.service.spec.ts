import { NotFoundException } from '@nestjs/common';
import { DriverOrderScopeService } from '../orders/driver-order-scope.service';
import { OrdersQueryService } from '../orders/orders-query.service';
import { DriverService } from './driver.service';

type Data = Record<string, any>;

function makeFirestore(records: Record<string, Data>) {
  const filters: Array<[string, string, unknown]> = [];
  const query = {
    where: jest.fn((field: string, operator: string, value: unknown) => {
      filters.push([field, operator, value]);
      return query;
    }),
    orderBy: jest.fn().mockReturnThis(),
    get: jest.fn(async () => {
      const docs = Object.entries(records)
        .filter(([path]) => path.startsWith('orders/'))
        .filter(([, data]) =>
          filters.every(([field, operator, value]) =>
            operator === 'in'
              ? Array.isArray(value) && value.includes(data[field])
              : data[field] === value,
          ),
        )
        .map(([path, data]) => ({
          id: path.split('/')[1],
          data: () => data,
        }));
      return { docs };
    }),
  };
  const firestore = {
    collection: jest.fn(() => query),
    doc: jest.fn((path: string) => ({
      get: jest.fn(async () => ({
        exists: path in records,
        data: () => records[path],
      })),
    })),
  };
  return { firestore, query };
}

function makeService(
  records: Record<string, Data>,
  driver: Data = { role: 'driver', driverApproved: true },
) {
  const { firestore, query } = makeFirestore(records);
  records['users/driver-1'] = { id: 'driver-1', ...driver };
  const ordersQuery = new OrdersQueryService(firestore as never);
  const driverScope = new DriverOrderScopeService(firestore as never);
  return {
    service: new DriverService(firestore as never, ordersQuery, driverScope),
    query,
  };
}

const paymentFields = [
  'required',
  'holdAt',
  'chargeId',
  'status',
  'canPay',
  'paid',
  'requiresRecovery',
];

describe('DriverService 주문 노출 범위와 읽기 계약', () => {
  it('미배정 PREPARING direct·hub와 본인 배정 PREPARING을 반환한다', async () => {
    const { service } = makeService({
      'orders/pickup-direct': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: null,
      },
      'orders/pickup-hub': {
        status: 'PREPARING',
        deliveryMethod: 'hub',
        driverId: null,
      },
      'orders/pickup-parcel': {
        status: 'PREPARING',
        deliveryMethod: 'parcel',
        driverId: null,
      },
      'orders/assigned-preparing': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
      'orders/other-driver': {
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-2',
      },
    });

    const result = await service.getOrders('driver-1');

    expect(result.map((order) => order.id)).toEqual([
      'pickup-direct',
      'pickup-hub',
      'assigned-preparing',
    ]);
  });

  it('본인 배정 DELIVERY_HELD·DELIVERING을 반환하고 다른 기사는 제외한다', async () => {
    const { service } = makeService({
      'orders/assigned-held': {
        status: 'DELIVERY_HELD',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
      'orders/assigned-delivering': {
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
      'orders/other-held': {
        status: 'DELIVERY_HELD',
        deliveryMethod: 'direct',
        driverId: 'driver-2',
      },
      'orders/finished': {
        status: 'DELIVERED',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
    });

    const result = await service.getOrders('driver-1');

    expect(result.map((order) => order.id)).toEqual(['assigned-held', 'assigned-delivering']);
  });

  it('status 필터에서도 DELIVERY_HELD를 포함한 기존 discovery 범위를 유지한다', async () => {
    const { service, query } = makeService({
      'orders/assigned-held': {
        status: 'DELIVERY_HELD',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
    });

    await expect(service.getOrders('driver-1', 'DELIVERY_HELD')).resolves.toHaveLength(1);
    expect(query.where).toHaveBeenCalledWith('status', 'in', ['DELIVERY_HELD']);
  });

  it('payment-required PREPARING·DELIVERY_HELD 주문에 authoritative 7개 필드를 포함한다', async () => {
    const hold = {
      heldAt: '2026-08-26T00:00:00.000Z',
      customerResponsible: true,
      redeliveryFee: 5000,
      resolvedAt: null,
    };
    const { service } = makeService({
      'orders/payment-preparing': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        deliveryHold: hold,
      },
      'orders/payment-held': {
        status: 'DELIVERY_HELD',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        deliveryHold: hold,
      },
    });

    const result = await service.getOrders('driver-1');

    expect(result).toHaveLength(2);
    for (const order of result) {
      expect(order.redeliveryPayment).toEqual(
        expect.objectContaining({
          required: true,
          status: 'MISSING',
        }),
      );
      expect(Object.keys(order.redeliveryPayment).sort()).toEqual([...paymentFields].sort());
    }
  });

  it('명시적 allowlist만 반환하고 미배정 discovery의 전화번호와 내부 필드를 제거한다', async () => {
    const internalFields = {
      userId: 'consumer-1',
      productId: 'product-1',
      totalAmount: 15000,
      deliveryFee: 3000,
      orderItems: [{ productId: 'product-1', unitPrice: 12000, subtotalAmount: 12000 }],
      redeliveryChargeId: 'charge-1',
      redeliveryChargeHoldAt: '2026-08-26T00:00:00.000Z',
      reservationId: 'reservation-1',
      clientOrderPayloadHash: 'hash',
      marketingConsent: { agreed: true },
      acquisition: { source: 'direct' },
      deliveryPhotoIds: ['photo-1'],
      deliveryPhone: '010-0000-0000',
      driverId: null,
    };
    const { service } = makeService({
      'orders/discovery': {
        ...internalFields,
        status: 'PREPARING',
        deliveryMethod: 'direct',
        buyerName: '소비자',
        buyerPhone: '010-1111-1111',
        sellerPhone: '010-2222-2222',
        address: '서울시 중구',
        lat: 37.56,
        lng: 126.98,
      },
      'orders/assigned-preparing': {
        ...internalFields,
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        sellerPhone: '010-2222-2222',
      },
      'orders/assigned-delivering': {
        ...internalFields,
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        buyerPhone: '010-1111-1111',
        sellerPhone: '010-2222-2222',
      },
    });

    const result = await service.getOrders('driver-1');
    const discovery = result.find((order) => order.id === 'discovery');
    expect(discovery).toMatchObject({
      id: 'discovery',
      address: '서울시 중구',
      lat: 37.56,
      lng: 126.98,
    });
    for (const order of result) {
      for (const field of [
        'userId',
        'productId',
        'totalAmount',
        'deliveryFee',
        'orderItems',
        'redeliveryChargeId',
        'redeliveryChargeHoldAt',
        'reservationId',
        'clientOrderPayloadHash',
        'marketingConsent',
        'acquisition',
        'deliveryPhotoIds',
        'deliveryPhone',
        'buyerPhone',
        'sellerPhone',
        'driverId',
      ]) {
        expect(order).not.toHaveProperty(field);
      }
    }

    await expect(service.getOrder('driver-1', 'discovery')).resolves.not.toHaveProperty(
      'sellerPhone',
    );
    await expect(service.getOrder('driver-1', 'discovery')).resolves.not.toHaveProperty(
      'buyerPhone',
    );
    await expect(service.getOrder('driver-1', 'assigned-preparing')).resolves.toHaveProperty(
      'sellerPhone',
      '010-2222-2222',
    );
    await expect(service.getOrder('driver-1', 'assigned-preparing')).resolves.not.toHaveProperty(
      'buyerPhone',
    );
    await expect(service.getOrder('driver-1', 'assigned-delivering')).resolves.toHaveProperty(
      'buyerPhone',
      '010-1111-1111',
    );
  });

  it('상세 보류 정보도 화면에 필요한 필드만 반환한다', async () => {
    const { service } = makeService({
      'orders/held': {
        status: 'DELIVERY_HELD',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
        deliveryHold: {
          heldAt: '2026-08-26T00:00:00.000Z',
          reasonCode: 'ACCESS_UNAVAILABLE',
          reasonMessage: '출입 불가',
          customerResponsible: false,
          redeliveryFee: null,
          nextContactAt: '2026-08-27T00:00:00.000Z',
          nextDeliveryAt: '2026-08-28T00:00:00.000Z',
          resolvedAt: null,
        },
      },
    });

    await expect(service.getOrder('driver-1', 'held')).resolves.toMatchObject({
      deliveryHold: {
        reasonCode: 'ACCESS_UNAVAILABLE',
        reasonMessage: '출입 불가',
        customerResponsible: false,
        redeliveryFee: null,
        nextContactAt: '2026-08-27T00:00:00.000Z',
        nextDeliveryAt: '2026-08-28T00:00:00.000Z',
      },
    });
    await expect(service.getOrder('driver-1', 'held')).resolves.not.toHaveProperty(
      'deliveryHold.heldAt',
    );
    await expect(service.getOrder('driver-1', 'held')).resolves.not.toHaveProperty(
      'deliveryHold.resolvedAt',
    );
  });

  it('상세도 목록과 동일한 visibility contract를 적용하고 arbitrary read를 거부한다', async () => {
    const { service } = makeService({
      'orders/unassigned-direct': {
        status: 'PREPARING',
        deliveryMethod: 'direct',
        driverId: null,
      },
      'orders/unassigned-hub': {
        status: 'PREPARING',
        deliveryMethod: 'hub',
        driverId: null,
      },
      'orders/assigned-held': {
        status: 'DELIVERY_HELD',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
      'orders/other-driver': {
        status: 'DELIVERING',
        deliveryMethod: 'direct',
        driverId: 'driver-2',
      },
      'orders/arbitrary': {
        status: 'DELIVERED',
        deliveryMethod: 'direct',
        driverId: 'driver-1',
      },
    });

    await expect(service.getOrder('driver-1', 'unassigned-direct')).resolves.toMatchObject({
      id: 'unassigned-direct',
    });
    await expect(service.getOrder('driver-1', 'unassigned-hub')).resolves.toMatchObject({
      id: 'unassigned-hub',
    });
    await expect(service.getOrder('driver-1', 'assigned-held')).resolves.toMatchObject({
      id: 'assigned-held',
    });
    await expect(service.getOrder('driver-1', 'other-driver')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getOrder('driver-1', 'arbitrary')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getOrder('driver-1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('round_direct 목록은 Pilot base와 direct discovery만 허용하고 legacy direct·hub는 보존한다', async () => {
    const { service } = makeService({
      'stores/pilot': { id: 'pilot', salesMode: 'round_direct' },
      'stores/legacy': { id: 'legacy', salesMode: 'legacy' },
      'stores/missing-mode': { id: 'missing-mode' },
      'stores/foreign': { id: 'foreign', salesMode: 'round_direct' },
      'saleRounds/round-valid': { id: 'round-valid', storeId: 'pilot' },
      'saleRounds/round-foreign': { id: 'round-foreign', storeId: 'foreign' },
      'orders/pilot-valid': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-valid',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/pilot-assigned': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-valid',
        deliveryMethod: 'direct',
        status: 'DELIVERING',
        driverId: 'driver-1',
      },
      'orders/pilot-other-driver': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-valid',
        deliveryMethod: 'direct',
        status: 'DELIVERING',
        driverId: 'driver-2',
      },
      'orders/missing-schema': {
        storeId: 'pilot',
        roundId: 'round-valid',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/missing-round-id': {
        storeId: 'pilot',
        schemaVersion: 2,
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/invalid-round-id': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-missing',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/foreign-round': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-foreign',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/pilot-hub': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-valid',
        deliveryMethod: 'hub',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/pilot-parcel': {
        storeId: 'pilot',
        schemaVersion: 2,
        roundId: 'round-valid',
        deliveryMethod: 'parcel',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/legacy-direct': {
        storeId: 'legacy',
        deliveryMethod: 'direct',
        status: 'PREPARING',
        driverId: null,
      },
      'orders/legacy-hub': {
        storeId: 'missing-mode',
        deliveryMethod: 'hub',
        status: 'PREPARING',
        driverId: null,
      },
    });

    const result = await service.getOrders('driver-1');

    expect(result.map((order) => order.id)).toEqual([
      'pilot-valid',
      'pilot-assigned',
      'legacy-direct',
      'legacy-hub',
    ]);
  });

  it.each([
    ['승인 필드가 정확한 true가 아님', { role: 'driver', driverApproved: false }],
    ['정지됨', { role: 'driver', driverApproved: true, suspended: true }],
    ['driver 역할이 아님', { role: 'consumer', driverApproved: true }],
  ])('%s이면 Driver 목록과 상세를 거부한다', async (_label, driver) => {
    const { service } = makeService(
      {
        'orders/order-1': {
          status: 'PREPARING',
          deliveryMethod: 'direct',
          driverId: null,
        },
      },
      driver,
    );

    await expect(service.getOrders('driver-1')).rejects.toThrow();
    await expect(service.getOrder('driver-1', 'order-1')).rejects.toThrow();
  });
});
