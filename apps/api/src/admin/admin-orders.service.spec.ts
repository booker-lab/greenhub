import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

function doc(data: Record<string, unknown> | null, id = 'doc') {
  return {
    id,
    exists: data !== null,
    data: () => data ?? undefined,
  };
}

function createOrderDetailService(order: Record<string, unknown> | null) {
  const docs = new Map<string, ReturnType<typeof doc>>([
    [
      'orders/order-1',
      doc(
        order && {
          id: 'order-1',
          storeId: 'store-1',
          userId: 'user-1',
          productId: 'product-1',
          productName: '호접란 3대',
          quantity: 2,
          totalAmount: 59000,
          status: 'PREPARING',
          createdAt: '2026-05-29T01:00:00.000Z',
          preparedAt: '2026-05-29T09:00:00.000Z',
          updatedAt: '2026-05-29T01:30:00.000Z',
          ...order,
        },
        'order-1',
      ),
    ],
    [
      'stores/store-1',
      doc({ id: 'store-1', name: '알파난원', ownerId: 'owner-1', status: 'active' }, 'store-1'),
    ],
    [
      'users/user-1',
      doc(
        {
          id: 'user-1',
          name: '김알파',
          email: 'buyer@example.com',
          phone: '010-1111-2222',
          passwordHash: 'secret',
        },
        'user-1',
      ),
    ],
    ['payments/order-1', doc({ amount: 59000, payMethod: 'CARD', status: 'paid' }, 'order-1')],
  ]);
  const firestore = {
    doc: jest.fn((path: string) => ({
      get: jest.fn().mockResolvedValue(docs.get(path) ?? doc(null)),
    })),
  };
  const service = new AdminService(firestore as never, {} as never);
  return { service, firestore };
}

describe('AdminService.getOrderDetail', () => {
  it('주문, 판매자, 구매자, 결제, 단일 상품 라인과 타임라인을 반환한다', async () => {
    const { service, firestore } = createOrderDetailService({});

    await expect(service.getOrderDetail('order-1')).resolves.toEqual({
      order: expect.objectContaining({ id: 'order-1', status: 'PREPARING' }),
      store: {
        id: 'store-1',
        name: '알파난원',
        ownerId: 'owner-1',
        status: 'active',
      },
      buyer: {
        id: 'user-1',
        name: '김알파',
        email: 'buyer@example.com',
        phone: '010-1111-2222',
      },
      payment: {
        id: 'order-1',
        amount: 59000,
        payMethod: 'CARD',
        status: 'paid',
      },
      items: [
        {
          productId: 'product-1',
          productName: '호접란 3대',
          quantity: 2,
          totalAmount: 59000,
        },
      ],
      timeline: [
        { label: '주문 생성', status: 'PENDING', at: '2026-05-29T01:00:00.000Z' },
        { label: '준비 예정 등록', status: 'PREPARING', at: '2026-05-29T09:00:00.000Z' },
        { label: '최근 상태 갱신', status: 'PREPARING', at: '2026-05-29T01:30:00.000Z' },
      ],
    });
    expect(firestore.doc).toHaveBeenCalledWith('orders/order-1');
    expect(firestore.doc).toHaveBeenCalledWith('payments/order-1');
  });

  it('주문이 없으면 404를 반환한다', async () => {
    const { service } = createOrderDetailService(null);

    await expect(service.getOrderDetail('order-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminService.getOrders', () => {
  it('page 쿼리는 count와 offset 기반 페이지 메타를 반환한다', async () => {
    const calls: string[] = [];
    const docs = Array.from({ length: 2 }, (_, index) =>
      doc({ id: `order-${index + 51}`, createdAt: `2026-05-${index + 1}` }),
    );
    const query = {
      where: jest.fn(() => query),
      orderBy: jest.fn(() => query),
      offset: jest.fn((value: number) => {
        calls.push(`offset:${value}`);
        return query;
      }),
      limit: jest.fn(() => query),
      count: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ data: () => ({ count: 52 }) }),
      })),
      get: jest.fn().mockResolvedValue({ docs }),
    };
    const firestore = {
      collection: jest.fn(() => query),
      Timestamp: { fromDate: jest.fn() },
    };
    const service = new AdminService(firestore as never, {} as never);

    await expect(service.getOrders({ page: 3, limit: 25 })).resolves.toEqual({
      orders: docs.map((item) => item.data()),
      total: 52,
      page: 3,
      pageSize: 25,
      totalPages: 3,
      hasPrevious: true,
      hasNext: false,
      nextCursor: null,
    });
    expect(query.count).toHaveBeenCalled();
    expect(calls).toContain('offset:50');
  });
});

function createTrackingService(order: Record<string, unknown> | null) {
  const update = jest.fn();
  const firestore = {
    Timestamp: { now: jest.fn(() => 'now') },
    doc: jest.fn(() => ({
      get: jest.fn().mockResolvedValue(doc(order, 'order-1')),
      update,
    })),
  };
  const service = new AdminService(firestore as never, {} as never);
  return { service, update };
}

describe('AdminService.updateOrderTracking', () => {
  it('발송 이후 택배 주문의 송장 정보를 정정한다', async () => {
    const { service, update } = createTrackingService({
      id: 'order-1',
      deliveryMethod: 'parcel',
      status: 'DELIVERED',
      courierCompany: 'CJ대한통운',
      trackingNumber: '1234567890',
    });

    await expect(
      service.updateOrderTracking(
        'order-1',
        { courierCompany: ' 한진 ', trackingNumber: ' 9876543210 ' },
        'admin-1',
      ),
    ).resolves.toEqual({
      ok: true,
      orderId: 'order-1',
      courierCompany: '한진',
      trackingNumber: '9876543210',
    });
    expect(update).toHaveBeenCalledWith({
      courierCompany: '한진',
      trackingNumber: '9876543210',
      trackingUpdatedAt: 'now',
      trackingUpdatedBy: 'admin-1',
      updatedAt: 'now',
    });
  });

  it('택배 주문이 아니면 차단한다', async () => {
    const { service } = createTrackingService({
      id: 'order-1',
      deliveryMethod: 'direct',
      status: 'DELIVERED',
    });

    await expect(
      service.updateOrderTracking(
        'order-1',
        { courierCompany: '한진', trackingNumber: '9876543210' },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('아직 송장이 없는 미발송 주문은 셀러 발송 플로우로 남긴다', async () => {
    const { service } = createTrackingService({
      id: 'order-1',
      deliveryMethod: 'parcel',
      status: 'PREPARING',
      courierCompany: null,
      trackingNumber: null,
    });

    await expect(
      service.updateOrderTracking(
        'order-1',
        { courierCompany: '한진', trackingNumber: '9876543210' },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('운송장번호는 3자 이상이어야 한다', async () => {
    const { service } = createTrackingService({
      id: 'order-1',
      deliveryMethod: 'parcel',
      status: 'DELIVERED',
    });

    await expect(
      service.updateOrderTracking(
        'order-1',
        { courierCompany: '한진', trackingNumber: '12' },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
