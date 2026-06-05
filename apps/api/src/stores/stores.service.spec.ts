import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StoresService } from './stores.service';

function createService(data: Record<string, unknown> | null) {
  const update = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockResolvedValue(undefined);
  const collectionQuery = {
    where: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ empty: true }),
  };
  const firestore = {
    doc: jest.fn((path: string) => {
      if (path === 'platform/config') {
        return {
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ defaultCommissionRate: 0.07 }),
          }),
          set,
        };
      }
      return {
        get: jest.fn().mockResolvedValue({
          exists: data !== null,
          data: () => data,
        }),
        set,
        update,
      };
    }),
    collection: jest.fn().mockReturnValue(collectionQuery),
    FieldValue: {
      serverTimestamp: jest.fn(() => 'server-timestamp'),
    },
    Timestamp: {
      now: jest.fn(() => 'now'),
    },
  };
  const service = new StoresService(firestore as never);
  return { service, update, set };
}

describe('StoresService', () => {
  const store = {
    id: 'store-1',
    ownerId: 'seller-1',
    name: '난플렉스',
    ceoName: '정연',
    phone: '010-1234-5678',
    address: '서울',
  };

  it('seller는 자신이 소유한 스토어만 조회할 수 있다', async () => {
    const { service } = createService(store);

    await expect(service.getStore('store-1', 'seller-2', 'seller')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('admin은 연결된 스토어 정보를 조회할 수 있다', async () => {
    const { service } = createService(store);

    await expect(service.getStore('store-1', 'admin-1', 'admin')).resolves.toMatchObject({
      id: 'store-1',
      name: '난플렉스',
    });
  });

  it('seller는 타인 스토어를 수정할 수 없다', async () => {
    const { service } = createService(store);

    await expect(
      service.updateStore('store-1', 'seller-2', { name: '변경 시도' }, 'seller'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('admin은 연결된 스토어를 수정할 수 있다', async () => {
    const { service, update } = createService(store);

    await expect(
      service.updateStore('store-1', 'admin-1', { name: '변경 완료' }, 'admin'),
    ).resolves.toEqual({ id: 'store-1' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '변경 완료',
      }),
    );
  });

  it('신규 스토어에 플랫폼 기본 수수료율을 복사한다', async () => {
    const { service, set } = createService(store);

    await expect(
      service.createStore('seller-1', {
        name: '신규 판매자',
        ceoName: '정연',
        phone: '010-1234-5678',
        address: '서울',
      }),
    ).resolves.toEqual({ storeId: expect.any(String) });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '신규 판매자',
        commissionRate: 0.07,
      }),
    );
  });

  it('공개 active 스토어 목록은 공개 필드와 집계만 반환한다', async () => {
    const stores = [
      {
        id: 'store-b',
        name: '바 상점',
        address: '부산',
        logoUrl: 'https://example.com/b.png',
        status: 'active',
      },
      { id: 'store-a', name: '가 상점', address: '서울', status: 'active' },
    ];
    const firestore = createPublicFirestore({ stores });
    const service = new StoresService(firestore as never);

    await expect(service.getPublicStores()).resolves.toEqual({
      total: 2,
      items: [
        expect.objectContaining({ id: 'store-a', name: '가 상점', productCount: 2, hubCount: 1 }),
        expect.objectContaining({ id: 'store-b', name: '바 상점', productCount: 2, hubCount: 1 }),
      ],
    });
  });

  it('공개 스토어 상세은 active 상품 요약만 반환한다', async () => {
    const firestore = createPublicFirestore({
      storeDetail: {
        id: 'store-a',
        name: '가 상점',
        address: '서울',
        phone: '010-1111-2222',
        status: 'active',
      },
      products: [
        {
          id: 'p2',
          storeId: 'store-a',
          name: '호접란',
          price: 20000,
          category: 'orchid',
          saleType: 'normal',
        },
        {
          id: 'p1',
          storeId: 'store-a',
          name: '장미',
          price: 10000,
          category: 'cut_flower',
          saleType: 'normal',
        },
      ],
    });
    const service = new StoresService(firestore as never);

    await expect(service.getPublicStore('store-a')).resolves.toMatchObject({
      store: { id: 'store-a', name: '가 상점', phone: '010-1111-2222' },
      products: [
        { id: 'p1', name: '장미', storeId: 'store-a', isActive: true },
        { id: 'p2', name: '호접란', storeId: 'store-a', isActive: true },
      ],
    });
  });

  it('공개 스토어 상세은 inactive 스토어를 숨긴다', async () => {
    const firestore = createPublicFirestore({
      storeDetail: { id: 'store-a', name: '가 상점', status: 'archived' },
    });
    const service = new StoresService(firestore as never);

    await expect(service.getPublicStore('store-a')).rejects.toBeInstanceOf(NotFoundException);
  });
});

function createPublicFirestore({
  stores = [],
  storeDetail,
  products,
}: {
  stores?: Record<string, unknown>[];
  storeDetail?: Record<string, unknown>;
  products?: Record<string, unknown>[];
}) {
  const activeProducts = products ?? [
    { id: 'product-1', storeId: 'store-a', name: '장미', isActive: true },
    { id: 'product-2', storeId: 'store-a', name: '난', isActive: true },
  ];
  const activeHubs = [{ id: 'hub-1', storeId: 'store-a', isActive: true }];

  function queryFor(collectionName: string) {
    const query = {
      where: jest.fn().mockReturnThis(),
      get: jest.fn().mockImplementation(() => {
        if (collectionName === 'stores') {
          return Promise.resolve({
            docs: stores.map((store) => ({ id: store.id, data: () => store })),
          });
        }
        if (collectionName === 'hubs') {
          return Promise.resolve({ docs: activeHubs.map((hub) => ({ data: () => hub })) });
        }
        return Promise.resolve({
          docs: activeProducts.map((product) => ({ data: () => product })),
        });
      }),
    };
    return query;
  }

  return {
    collection: jest.fn((collectionName: string) => queryFor(collectionName)),
    doc: jest.fn(() => ({
      get: jest.fn().mockResolvedValue({
        exists: Boolean(storeDetail),
        data: () => storeDetail,
      }),
    })),
  };
}
