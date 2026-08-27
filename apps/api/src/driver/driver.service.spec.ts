import { NotFoundException } from '@nestjs/common';
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

function makeService(records: Record<string, Data>) {
  const { firestore, query } = makeFirestore(records);
  const ordersQuery = new OrdersQueryService(firestore as never);
  return { service: new DriverService(firestore as never, ordersQuery), query };
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
});
