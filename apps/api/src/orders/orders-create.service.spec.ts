import { OrdersCreateService } from './orders-create.service';

function createSnap(data: Record<string, unknown> | null) {
  return {
    exists: data !== null,
    data: () => data,
  };
}

function createService(capData: Record<string, unknown> | null) {
  const docPaths: string[] = [];
  const updates: Array<{ path: string; data: Record<string, unknown> }> = [];
  const sets: Array<{ path: string; data: Record<string, unknown> }> = [];

  const firestore = {
    doc: jest.fn((path: string) => {
      docPaths.push(path);
      return { path };
    }),
    Timestamp: {
      now: jest.fn(() => 'now'),
      fromDate: jest.fn((date: Date) => date),
    },
    runTransaction: jest.fn(async (callback: (transaction: unknown) => Promise<void>) => {
      const transaction = {
        get: jest.fn(async (ref: { path: string }) => {
          if (ref.path.startsWith('orderCounters/')) return createSnap({ seq: 0 });
          if (ref.path === 'dailyCaps/store-1_2026-06-10') return createSnap(capData);
          throw new Error(`예상하지 않은 transaction get: ${ref.path}`);
        }),
        update: jest.fn((ref: { path: string }, data: Record<string, unknown>) => {
          updates.push({ path: ref.path, data });
        }),
        set: jest.fn((ref: { path: string }, data: Record<string, unknown>) => {
          sets.push({ path: ref.path, data });
        }),
      };
      await callback(transaction);
    }),
  };

  firestore.doc.mockImplementation((path: string) => {
    docPaths.push(path);
    return {
      path,
      get: jest.fn(async () => {
        if (path === 'products/product-1') {
          return createSnap({
            id: 'product-1',
            storeId: 'store-1',
            name: '호접란',
            price: 10000,
            deliverySize: 'small',
          });
        }
        if (path === 'users/user-1') {
          return createSnap({ id: 'user-1', name: '구매자', email: 'buyer@example.com' });
        }
        if (path === 'stores/store-1') {
          return createSnap({ id: 'store-1', phone: '010-0000-0000' });
        }
        if (path === 'deliveryFeeConfig/store-1') {
          return createSnap(null);
        }
        return createSnap(null);
      }),
    };
  });

  const service = new OrdersCreateService(firestore as never, {} as never);
  return { service, firestore, updates, sets, docPaths };
}

const baseDto = {
  productId: 'product-1',
  quantity: 2,
  saleType: 'normal',
  deliveryMethod: 'hub',
  hubId: 'hub-1',
  deliveryAddress: {
    address: '서울시 강남구',
    addressDetail: '101호',
    zipCode: '06000',
  },
  requestedDeliveryDate: '2026-06-10',
};

describe('OrdersCreateService', () => {
  it('일반 비택배 주문은 선택 배송일 dailyCaps를 0 기준으로 차감한다', async () => {
    const { service, updates, sets } = createService({ totalCap: 3 });

    await service.createOrder('store-1', 'user-1', baseDto);

    expect(updates).toContainEqual({
      path: 'dailyCaps/store-1_2026-06-10',
      data: { usedSlots: 2 },
    });
    expect(sets.find((entry) => entry.path.startsWith('orders/'))?.data).toMatchObject({
      requestedDeliveryDate: '2026-06-10',
      saleType: 'normal',
      deliveryMethod: 'hub',
    });
  });

  it('일반 택배 주문은 배송일을 저장하지 않고 dailyCaps를 읽지 않는다', async () => {
    const { service, updates, sets, docPaths } = createService({ totalCap: 3, usedSlots: 0 });

    await service.createOrder('store-1', 'user-1', {
      ...baseDto,
      deliveryMethod: 'parcel',
      hubId: undefined,
      requestedDeliveryDate: undefined,
    });

    expect(docPaths).not.toContain('dailyCaps/store-1_2026-06-10');
    expect(updates).toEqual([]);
    expect(sets.find((entry) => entry.path.startsWith('orders/'))?.data).toMatchObject({
      requestedDeliveryDate: null,
      deliveryMethod: 'parcel',
    });
  });
});
