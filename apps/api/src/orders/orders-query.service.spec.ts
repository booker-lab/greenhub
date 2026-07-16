import { ForbiddenException } from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { OrdersQueryService } from './orders-query.service';

type RecordMap = Record<string, Record<string, unknown>>;

function makeFirestore(records: RecordMap) {
  const makeQuery = (filters: Array<[string, unknown]> = []) => ({
    where: jest.fn((field: string, _operator: string, value: unknown) =>
      makeQuery([...filters, [field, value]]),
    ),
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

  it('소비자 목록은 요청한 필터와 무관하게 본인 주문만 반환한다', async () => {
    const service = new OrdersQueryService(makeFirestore(records) as never);

    const result = await service.getOrders('store-1', requester('consumer-1', 'consumer'), {
      userId: 'consumer-2',
    });

    expect(result.map((order) => order.id)).toEqual(['order-1']);
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

  it('기사는 실제 배정된 주문만 목록과 상세에서 조회할 수 있다', async () => {
    const service = new OrdersQueryService(makeFirestore(records) as never);
    const driver = requester('driver-1', 'driver');

    const result = await service.getOrders('store-1', driver, {});
    expect(result.map((order) => order.id)).toEqual(['order-1']);
    await expect(service.getOrder('store-1', 'order-2', driver)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
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
});
