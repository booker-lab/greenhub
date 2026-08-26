import { ConflictException } from '@nestjs/common';
import { OrdersCreateService } from './orders-create.service';

type Data = Record<string, any>;

function makeSnap(data: Data | null) {
  return { exists: data !== null, data: () => data };
}

function makeFirestore(initial: Record<string, Data>) {
  const records = new Map(Object.entries(initial));
  const refs = new Map<string, Data>();

  const doc = jest.fn((path: string) => {
    if (!refs.has(path)) {
      refs.set(path, {
        path,
        get: jest.fn(async () => makeSnap(records.get(path) ?? null)),
        set: jest.fn(async (data: Data, options?: { merge?: boolean }) => {
          const current = records.get(path) ?? {};
          records.set(path, options?.merge ? { ...current, ...data } : data);
        }),
        update: jest.fn(async (data: Data) => {
          records.set(path, { ...(records.get(path) ?? {}), ...data });
        }),
      });
    }
    return refs.get(path);
  });

  const firestore = {
    doc,
    collection: jest.fn((name: string) => {
      const filters: Array<[string, unknown]> = [];
      const query = {
        where(field: string, _operator: string, value: unknown) {
          filters.push([field, value]);
          return query;
        },
        async get() {
          const docs = Array.from(records.entries())
            .filter(([path]) => path.startsWith(`${name}/`))
            .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
            .map(([, data]) => ({ data: () => data }));
          return { docs };
        },
      };
      return query;
    }),
    runTransaction: jest.fn(async (callback: (tx: Data) => Promise<unknown>) => {
      const pending = new Map<string, Data>();
      const tx = {
        get: jest.fn(async (ref: Data) =>
          makeSnap(pending.get(ref.path) ?? records.get(ref.path) ?? null),
        ),
        set: jest.fn((ref: Data, data: Data, options?: { merge?: boolean }) => {
          const current = pending.get(ref.path) ?? records.get(ref.path) ?? {};
          pending.set(ref.path, options?.merge ? { ...current, ...data } : data);
        }),
        update: jest.fn((ref: Data, data: Data) => {
          const current = pending.get(ref.path) ?? records.get(ref.path) ?? {};
          pending.set(ref.path, { ...current, ...data });
        }),
      };
      const result = await callback(tx);
      for (const [path, data] of pending) records.set(path, data);
      return result;
    }),
    Timestamp: {
      now: jest.fn(() => new Date('2026-08-25T00:00:00.000Z')),
      fromDate: jest.fn((date: Date) => date),
    },
  };
  return { firestore, records };
}

function legacyRecords(cap: Data, deliveryMethod = 'direct') {
  return {
    'stores/store-1': { id: 'store-1', salesMode: 'legacy', phone: '010-1111-2222' },
    'users/user-1': {
      id: 'user-1',
      name: '고객',
      email: 'buyer@example.com',
      phone: '010-3333-4444',
    },
    'products/product-1': {
      id: 'product-1',
      storeId: 'store-1',
      name: '미니 호접란',
      price: 10000,
      deliverySize: 'small',
    },
    'dailyCaps/store-1_2026-08-25': cap,
    ...(deliveryMethod === 'hub'
      ? { 'hubs/hub-1': { id: 'hub-1', name: '이천 거점', address: '이천시 중리천로' } }
      : {}),
  };
}

function makeService(firestore: Data) {
  return new OrdersCreateService(
    firestore,
    { processGroupBuyEarlyConfirm: jest.fn() } as never,
    {} as never,
    {} as never,
  );
}

function orderRequest(overrides: Data = {}) {
  return {
    productId: 'product-1',
    quantity: 3,
    saleType: 'normal',
    deliveryMethod: 'direct',
    requestedDeliveryDate: '2026-08-25',
    deliveryPhone: '010-9999-0000',
    deliveryAddress: {
      address: '경기도 이천시 중리천로 1',
      addressDetail: '201호',
      zipCode: '17373',
    },
    ...overrides,
  };
}

describe('legacy daily capacity 주문 예약', () => {
  it.each([
    'direct',
    'hub',
  ])('%s 주문은 persisted usedSlots에서 정상적으로 증가한다', async (deliveryMethod) => {
    const { firestore, records } = makeFirestore(
      legacyRecords(
        { storeId: 'store-1', date: '2026-08-25', totalCap: 10, usedSlots: 2 },
        deliveryMethod,
      ),
    );
    const service = makeService(firestore);
    const request = orderRequest({
      deliveryMethod,
      ...(deliveryMethod === 'hub' ? { hubId: 'hub-1' } : {}),
    });

    await service.createOrder('store-1', 'user-1', request as never);

    expect(records.get('dailyCaps/store-1_2026-08-25')?.usedSlots).toBe(5);
  });

  it.each([
    ['group direct', { saleType: 'group', deliveryMethod: 'direct' }],
    ['group hub', { saleType: 'group', deliveryMethod: 'hub', hubId: 'hub-1' }],
    ['parcel', { saleType: 'normal', deliveryMethod: 'parcel' }],
  ])('%s 주문은 daily cap을 사용하지 않는다', async (_label, overrides) => {
    const { firestore, records } = makeFirestore({
      ...legacyRecords(
        { storeId: 'store-1', date: '2026-08-25', totalCap: 2, usedSlots: 2 },
        overrides.deliveryMethod,
      ),
      ...(overrides.saleType === 'group'
        ? {
            'groupProductConfig/product-1': {
              maxPerPerson: 10,
              currentQuantity: 0,
              targetQuantity: 10,
            },
          }
        : {}),
    });
    const service = makeService(firestore);
    const request = orderRequest({
      ...overrides,
      quantity: 1,
      ...(overrides.saleType === 'group'
        ? { groupBuyConsent: { agreed: true, agreedAt: '2026-08-24T00:00:00.000Z' } }
        : {}),
    });

    await service.createOrder('store-1', 'user-1', request as never);

    expect(records.get('dailyCaps/store-1_2026-08-25')?.usedSlots).toBe(2);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['negative', -1],
    ['string', '2'],
    ['over totalCap', 11],
  ])('%s usedSlots는 NaN write 없이 fail-closed한다', async (_label, usedSlots) => {
    const { firestore, records } = makeFirestore(
      legacyRecords({ storeId: 'store-1', date: '2026-08-25', totalCap: 10, usedSlots }),
    );
    const service = makeService(firestore);

    await expect(
      service.createOrder('store-1', 'user-1', orderRequest() as never),
    ).rejects.toBeInstanceOf(ConflictException);

    const cap = records.get('dailyCaps/store-1_2026-08-25');
    expect(Number.isNaN(cap?.usedSlots)).toBe(Number.isNaN(usedSlots));
    expect(cap?.usedSlots).toBe(usedSlots);
    expect(Array.from(records.keys()).some((path) => path.startsWith('orders/'))).toBe(false);
  });

  it('용량이 마감된 정상 문서는 기존 conflict로 거부한다', async () => {
    const { firestore } = makeFirestore(
      legacyRecords({ storeId: 'store-1', date: '2026-08-25', totalCap: 2, usedSlots: 2 }),
    );
    const service = makeService(firestore);

    await expect(
      service.createOrder('store-1', 'user-1', orderRequest({ quantity: 1 }) as never),
    ).rejects.toThrow('당일 배송 슬롯이 마감되었습니다.');
  });
});
