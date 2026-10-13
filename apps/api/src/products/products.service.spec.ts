import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';

describe('공개 상품 API', () => {
  it('활성 공개 상품만 조회하고 시험용 상품은 제외한다', async () => {
    const docs = [
      { data: () => ({ id: 'public-001', saleType: 'normal', isActive: true, name: '공개 상품' }) },
      {
        data: () => ({
          id: 'e2e-001',
          saleType: 'normal',
          isActive: true,
          testOnly: true,
          name: '시험용 상품',
        }),
      },
    ];
    const get = jest.fn().mockResolvedValue({ docs });
    const where = jest.fn().mockReturnValue({ get });
    const firestore = {
      collection: jest.fn().mockReturnValue({ where }),
    };
    const service = new ProductsService(firestore as never);

    const result = (await service.getPublicProducts({ isActive: false })) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };

    expect(where).toHaveBeenCalledWith('isActive', '==', true);
    expect(result.items.map((item) => item['id'])).toEqual(['public-001']);
    expect(result.total).toBe(1);
  });

  it.each([
    ['비활성 상품', { id: 'inactive-001', isActive: false, saleType: 'normal' }],
    ['시험용 상품', { id: 'e2e-001', isActive: true, testOnly: true, saleType: 'normal' }],
  ])('%s 상세 조회를 상품 없음으로 처리한다', async (_label, product) => {
    const firestore = {
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: true, data: () => product }),
      }),
    };
    const service = new ProductsService(firestore as never);

    await expect(service.getPublicProduct(product.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('활성 공개 상품 상세는 public projection으로 반환한다', async () => {
    const product = {
      id: 'public-001',
      storeId: 'store-1',
      isActive: true,
      saleType: 'normal',
      name: '공개 상품',
      images: ['https://example.com/a.jpg'],
      price: 10000,
      category: 'cut_flower',
      deliverySize: 'small',
      sellerNote: '내부 메모',
      sellerOverride: true,
      testOnly: false,
      content: { headline: '제목', description: '설명', isEditedByUser: true },
    };
    const firestore = {
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: true, data: () => product }),
      }),
    };
    const service = new ProductsService(firestore as never);

    const detail = (await service.getPublicProduct(product.id)) as Record<string, unknown>;
    expect(detail).not.toHaveProperty('sellerNote');
    expect(detail).not.toHaveProperty('sellerOverride');
    expect(detail).not.toHaveProperty('testOnly');
    expect(detail['content']).toEqual({ headline: '제목', description: '설명' });
    expect(detail['id']).toBe('public-001');
  });

  it('public group detail에서 isProcessed를 제거한다', async () => {
    const product = {
      id: 'group-001',
      storeId: 'store-1',
      isActive: true,
      saleType: 'group',
      name: '공구 상품',
      images: [],
      price: 5000,
      category: 'cut_flower',
      deliverySize: 'small',
    };
    const groupConfig = {
      productId: 'group-001',
      minQuantity: 5,
      targetQuantity: 10,
      maxPerPerson: 2,
      recruitDeadline: '2026-09-10T00:00:00.000Z',
      currentQuantity: 3,
      groupDeliveryDate: '2026-09-15T00:00:00.000Z',
      groupDeliveryMethod: 'direct',
      deliveryFeeDiscount: 0,
      isProcessed: true,
    };
    const firestore = {
      doc: jest.fn((path: string) => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => (path === 'products/group-001' ? product : groupConfig),
        }),
      })),
    };
    const service = new ProductsService(firestore as never);

    const detail = (await service.getPublicProduct('group-001')) as Record<string, unknown>;
    const gc = detail['groupConfig'] as Record<string, unknown>;
    expect(gc).not.toHaveProperty('isProcessed');
    expect(gc['currentQuantity']).toBe(3);
  });
});

describe('store-scoped anonymous product API 우회 차단', () => {
  function makeChainable(docs: Array<{ data: () => unknown }>) {
    const get = jest.fn().mockResolvedValue({ docs });
    const query: { where: jest.Mock; get: jest.Mock } = {
      where: jest.fn(() => query),
      get,
    };
    return query;
  }

  it('store 목록에서 inactive/testOnly를 제외하고 isActive=false 우회를 막는다', async () => {
    const docs = [
      { data: () => ({ id: 'public-001', storeId: 's-1', isActive: true, saleType: 'normal' }) },
      { data: () => ({ id: 'inactive-001', storeId: 's-1', isActive: false, saleType: 'normal' }) },
      {
        data: () => ({
          id: 'e2e-001',
          storeId: 's-1',
          isActive: true,
          testOnly: true,
          saleType: 'normal',
        }),
      },
    ];
    const query = makeChainable(docs);
    const firestore = {
      collection: jest.fn().mockReturnValue(query),
      doc: jest.fn(),
    };
    const service = new ProductsService(firestore as never);

    // isActive=false를 요청해도 공개 predicate를 우회하지 못한다.
    const result = (await service.getProducts('s-1', { isActive: false } as never)) as {
      items: Array<Record<string, unknown>>;
    };
    expect(query.where).toHaveBeenCalledWith('isActive', '==', true);
    expect(result.items.map((item) => item['id'])).toEqual(['public-001']);
  });

  it.each([
    ['비활성 상품', { id: 'p-1', storeId: 's-1', isActive: false, saleType: 'normal' }],
    [
      '시험용 상품',
      { id: 'p-1', storeId: 's-1', isActive: true, testOnly: true, saleType: 'normal' },
    ],
  ])('store 상세에서 %s를 상품 없음으로 처리한다', async (_label, product) => {
    const firestore = {
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: true, data: () => product }),
      }),
    };
    const service = new ProductsService(firestore as never);

    await expect(service.getProduct('s-1', 'p-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('store 상세가 다른 store 상품을 반환하지 않는다', async () => {
    const product = { id: 'p-1', storeId: 'other-store', isActive: true, saleType: 'normal' };
    const firestore = {
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: true, data: () => product }),
      }),
    };
    const service = new ProductsService(firestore as never);

    await expect(service.getProduct('s-1', 'p-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('seller owner/internal read regression', () => {
  it('owner 상세는 내부 필드를 보존한다', async () => {
    const product = {
      id: 'p-1',
      storeId: 's-1',
      isActive: false,
      testOnly: true,
      saleType: 'normal',
      name: '비활성 시험 상품',
      sellerNote: '내부 메모',
      sellerOverride: true,
      content: { headline: '제목', description: '설명', isEditedByUser: true },
    };
    const firestore = {
      doc: jest.fn((path: string) => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => (path === 'stores/s-1' ? { ownerId: 'seller-1' } : product),
        }),
      })),
    };
    const service = new ProductsService(firestore as never);

    const owner = (await service.getOwnerProduct('s-1', 'p-1', 'seller-1', 'seller')) as Record<
      string,
      unknown
    >;
    expect(owner['sellerNote']).toBe('내부 메모');
    expect(owner['sellerOverride']).toBe(true);
    expect(owner['content']).toEqual({
      headline: '제목',
      description: '설명',
      isEditedByUser: true,
    });
  });

  it('owner가 아닌 seller의 owner 조회를 거부한다', async () => {
    const product = { id: 'p-1', storeId: 's-1', isActive: true, saleType: 'normal' };
    const firestore = {
      doc: jest.fn((path: string) => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => (path === 'stores/s-1' ? { ownerId: 'seller-1' } : product),
        }),
      })),
    };
    const service = new ProductsService(firestore as never);

    await expect(service.getOwnerProduct('s-1', 'p-1', 'seller-2', 'seller')).rejects.toThrow();
  });
});

describe('legacy daily cap 날짜 기본값', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('KST 자정 직후에도 오늘 날짜를 KST 기준으로 조회한다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-24T15:30:00.000Z'));

    const calls: unknown[][] = [];
    const query = {} as {
      where: jest.Mock;
      get: jest.Mock;
    };
    query.where = jest.fn((...args: unknown[]) => {
      calls.push(args);
      return query;
    });
    query.get = jest.fn().mockResolvedValue({ docs: [] });

    const firestore = {
      doc: jest.fn(),
      collection: jest.fn().mockReturnValue(query),
    };
    const service = new ProductsService(firestore as never);

    await service.getDailyCaps('store-1', 'seller-1', undefined, undefined, 'admin');

    expect(calls).toContainEqual(['date', '>=', '2026-08-25']);
    expect(calls).toContainEqual(['date', '<=', '2026-08-25']);
  });
});

describe('legacy daily cap 초기화', () => {
  type Data = Record<string, any>;

  function makeFirestore(initial: Record<string, Data>) {
    const records = new Map(Object.entries(initial));
    const refs = new Map<string, Data>();
    const doc = jest.fn((path: string) => {
      if (!refs.has(path)) {
        refs.set(path, {
          path,
          get: jest.fn(async () => ({
            exists: records.has(path),
            data: () => records.get(path),
          })),
        });
      }
      return refs.get(path);
    });
    const firestore = {
      doc,
      runTransaction: jest.fn(async (callback: (tx: Data) => Promise<unknown>) => {
        const pending = new Map<string, Data>();
        const tx = {
          get: jest.fn(async (ref: Data) => ({
            exists: pending.has(ref.path) || records.has(ref.path),
            data: () => pending.get(ref.path) ?? records.get(ref.path),
          })),
          set: jest.fn((ref: Data, data: Data, options?: { merge?: boolean }) => {
            const current = pending.get(ref.path) ?? records.get(ref.path) ?? {};
            pending.set(ref.path, options?.merge ? { ...current, ...data } : data);
          }),
        };
        const result = await callback(tx);
        for (const [path, data] of pending) records.set(path, data);
        return result;
      }),
    };
    return { firestore, records };
  }

  it('새 daily cap 문서는 usedSlots 0으로 생성한다', async () => {
    const { firestore, records } = makeFirestore({});
    const service = new ProductsService(firestore as never);

    await expect(
      service.updateDailyCap('store-1', '2026-08-25', 'admin-1', 10, 'admin'),
    ).resolves.toMatchObject({
      id: 'store-1_2026-08-25',
      totalCap: 10,
      usedSlots: 0,
    });
    expect(records.get('dailyCaps/store-1_2026-08-25')).toMatchObject({ usedSlots: 0 });
  });

  it('기존 daily cap의 usedSlots와 누락 상태를 totalCap 수정으로 초기화하지 않는다', async () => {
    const { firestore, records } = makeFirestore({
      'dailyCaps/store-1_2026-08-25': { totalCap: 10, usedSlots: 3 },
      'dailyCaps/store-1_2026-08-26': { totalCap: 10 },
    });
    const service = new ProductsService(firestore as never);

    await service.updateDailyCap('store-1', '2026-08-25', 'admin-1', 12, 'admin');
    await service.updateDailyCap('store-1', '2026-08-26', 'admin-1', 12, 'admin');

    expect(records.get('dailyCaps/store-1_2026-08-25')).toMatchObject({
      totalCap: 12,
      usedSlots: 3,
    });
    expect(records.get('dailyCaps/store-1_2026-08-26')).not.toHaveProperty('usedSlots');
  });
});

describe('판매자 상품·배송비 쓰기 경로', () => {
  type Data = Record<string, any>;
  const NOW = { seconds: 1_790_000_000, nanoseconds: 0 };

  function makeFirestore(initial: Record<string, Data>) {
    const records = new Map(Object.entries(initial));
    const doc = jest.fn((path: string) => ({
      get: jest.fn(async () => ({ exists: records.has(path), data: () => records.get(path) })),
      set: jest.fn(async (data: Data, options?: { merge?: boolean }) => {
        records.set(path, options?.merge ? { ...(records.get(path) ?? {}), ...data } : data);
      }),
      update: jest.fn(async (data: Data) => {
        records.set(path, { ...(records.get(path) ?? {}), ...data });
      }),
      delete: jest.fn(async () => {
        records.delete(path);
      }),
    }));
    const firestore = { doc, Timestamp: { now: () => NOW } };
    return { firestore, records };
  }

  const ownedStore = { 'stores/store-1': { id: 'store-1', ownerId: 'seller-1' } };
  const baseDto = {
    name: '호접란',
    images: ['https://firebasestorage.googleapis.com/v0/b/b/o/products%2Fstore-1%2Fa.jpg'],
    price: 12000,
    category: 'orchid',
    saleType: 'normal',
    deliverySize: 'small',
  };

  it('상품 생성은 소유 매장에 활성 상품을 만들고 owner 상세를 돌려준다', async () => {
    const { firestore, records } = makeFirestore(ownedStore);
    const service = new ProductsService(firestore as never);

    const detail = (await service.createProduct('store-1', 'seller-1', baseDto)) as Data;
    const [path, stored] = [...records].find(([key]) => key.startsWith('products/'))!;

    expect(stored).toMatchObject({
      ...baseDto,
      id: path.replace('products/', ''),
      storeId: 'store-1',
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(detail['id']).toBe(stored['id']);
    expect([...records.keys()].some((key) => key.startsWith('groupProductConfig/'))).toBe(false);
  });

  it('공동구매 상품 생성은 모집 설정을 날짜로 바꿔 함께 저장한다', async () => {
    const { firestore, records } = makeFirestore(ownedStore);
    const service = new ProductsService(firestore as never);

    await service.createProduct('store-1', 'seller-1', {
      ...baseDto,
      saleType: 'group',
      isActive: false,
      groupConfig: {
        minQuantity: 5,
        targetQuantity: 10,
        maxPerPerson: 2,
        recruitDeadline: '2026-09-10T00:00:00.000Z',
        groupDeliveryDate: '2026-09-15T00:00:00.000Z',
        groupDeliveryMethod: 'direct',
        deliveryFeeDiscount: 0,
      },
    });
    const product = [...records].find(([key]) => key.startsWith('products/'))![1];
    const config = records.get(`groupProductConfig/${product['id']}`)!;

    expect(product['isActive']).toBe(false);
    expect(product).not.toHaveProperty('groupConfig');
    expect(config).toMatchObject({
      productId: product['id'],
      currentQuantity: 0,
      isProcessed: false,
      recruitDeadline: new Date('2026-09-10T00:00:00.000Z'),
      groupDeliveryDate: new Date('2026-09-15T00:00:00.000Z'),
    });
  });

  it('소유하지 않은 매장에는 상품을 만들지 않는다', async () => {
    const { firestore, records } = makeFirestore(ownedStore);
    const service = new ProductsService(firestore as never);

    await expect(service.createProduct('store-1', 'seller-2', baseDto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect([...records.keys()]).toEqual(['stores/store-1']);
  });

  it('상품 삭제는 같은 매장 상품만 지운다', async () => {
    const { firestore, records } = makeFirestore({
      ...ownedStore,
      'products/p-1': { id: 'p-1', storeId: 'store-1' },
      'products/p-2': { id: 'p-2', storeId: 'store-2' },
    });
    const service = new ProductsService(firestore as never);

    await service.deleteProduct('store-1', 'p-1', 'seller-1');
    await expect(service.deleteProduct('store-1', 'p-2', 'seller-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.deleteProduct('store-1', 'missing', 'seller-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(records.has('products/p-1')).toBe(false);
    expect(records.has('products/p-2')).toBe(true);
  });

  it('소유하지 않은 판매자의 상품 삭제를 거부한다', async () => {
    const { firestore, records } = makeFirestore({
      ...ownedStore,
      'products/p-1': { id: 'p-1', storeId: 'store-1' },
    });
    const service = new ProductsService(firestore as never);

    await expect(service.deleteProduct('store-1', 'p-1', 'seller-2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(records.has('products/p-1')).toBe(true);
  });

  it('배송비 수정은 기존 설정에 병합하고 저장된 설정을 돌려준다', async () => {
    const { firestore, records } = makeFirestore({
      ...ownedStore,
      'deliveryFeeConfig/store-1': { storeId: 'store-1', directFee: 3000, hubFee: 1000 },
    });
    const service = new ProductsService(firestore as never);

    const result = await service.updateDeliveryConfig('store-1', 'seller-1', { directFee: 3500 });

    expect(result).toEqual({ storeId: 'store-1', directFee: 3500, hubFee: 1000, updatedAt: NOW });
    expect(records.get('deliveryFeeConfig/store-1')).toEqual(result);
  });

  it('소유하지 않은 판매자의 배송비 수정을 거부한다', async () => {
    const { firestore, records } = makeFirestore(ownedStore);
    const service = new ProductsService(firestore as never);

    await expect(
      service.updateDeliveryConfig('store-1', 'seller-2', { directFee: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(records.has('deliveryFeeConfig/store-1')).toBe(false);
  });
});
