import { ProductsService } from './products.service';

describe('ProductsService', () => {
  it('공개 공구 목록은 30개 초과 공구 설정도 병합한다', async () => {
    const products = Array.from({ length: 31 }, (_, index) => ({
      id: `product-${index + 1}`,
      storeId: 'store-1',
      name: `공구 상품 ${index + 1}`,
      price: 10000,
      images: [],
      category: 'orchid',
      saleType: 'group',
      isActive: true,
      createdAt: { seconds: index },
    }));
    const configs = products.map((product, index) => ({
      productId: product.id,
      currentQuantity: index,
      minQuantity: 5,
      targetQuantity: 10,
      recruitDeadline: '2026-06-18T00:00:00.000Z',
    }));
    const groupWhereCalls: unknown[][] = [];
    const firestore = createPublicProductsFirestore(products, configs, groupWhereCalls);
    const service = new ProductsService(firestore as never);

    const result = await service.getPublicProducts({ saleType: 'group' });

    expect(result.total).toBe(31);
    expect(result.items).toHaveLength(31);
    expect(result.items.find((item: any) => item.id === 'product-31')).toMatchObject({
      id: 'product-31',
      groupSummary: {
        currentQuantity: 30,
        minQuantity: 5,
        targetQuantity: 10,
      },
    });
    expect(groupWhereCalls).toHaveLength(2);
    expect(groupWhereCalls[0]?.[2]).toHaveLength(30);
    expect(groupWhereCalls[1]?.[2]).toHaveLength(1);
  });

  it('공개 목록은 가격·배송·판매자 힌트와 서버 total 계약을 반환한다', async () => {
    const products = [
      {
        id: 'normal-1',
        storeId: 'store-1',
        name: '일반 상품',
        price: 12000,
        images: ['normal.jpg'],
        category: 'orchid',
        saleType: 'normal',
        deliverySize: 'small',
        isActive: true,
        createdAt: { seconds: 2 },
      },
      {
        id: 'group-1',
        storeId: 'store-2',
        name: '공구 상품',
        price: 18000,
        images: ['group.jpg'],
        category: 'orchid',
        saleType: 'group',
        deliverySize: 'medium',
        isActive: true,
        createdAt: { seconds: 1 },
      },
      {
        id: 'expensive-1',
        storeId: 'store-1',
        name: '비싼 상품',
        price: 40000,
        images: [],
        category: 'orchid',
        saleType: 'normal',
        deliverySize: 'large',
        isActive: true,
        createdAt: { seconds: 3 },
      },
    ];
    const configs = [
      {
        productId: 'group-1',
        currentQuantity: 4,
        minQuantity: 5,
        targetQuantity: 10,
        recruitDeadline: '2026-06-18T00:00:00.000Z',
        groupDeliveryDate: '2026-06-30T00:00:00.000Z',
        groupDeliveryMethod: 'parcel',
        deliveryFeeDiscount: 0,
      },
    ];
    const firestore = createPublicProductsFirestore(products, configs, [], {
      deliveryConfigs: {
        'deliveryFeeConfig/store-1': { weatherRestrictionActive: true },
      },
      stores: {
        'stores/store-1': { name: '첫 번째 상점' },
      },
    });
    const service = new ProductsService(firestore as never);

    const result = await service.getPublicProducts({
      priceMin: 10000,
      priceMax: 20000,
      deliveryMethod: 'parcel',
    });

    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'group-1',
        sellerSummary: { storeId: 'store-2', name: 'store-2' },
        deliverySummary: {
          methods: ['parcel'],
          deliverySize: 'medium',
          weatherRestricted: false,
          groupDeliveryDate: '2026-06-30T00:00:00.000Z',
          deliveryFeeDiscount: 0,
        },
      }),
    ]);
  });
});

function createPublicProductsFirestore(
  products: Record<string, unknown>[],
  configs: Record<string, unknown>[],
  groupWhereCalls: unknown[][],
  options: {
    deliveryConfigs?: Record<string, Record<string, unknown>>;
    stores?: Record<string, Record<string, unknown>>;
  } = {},
) {
  return {
    doc: jest.fn((path: string) => ({
      get: jest.fn(async () => {
        const data = options.deliveryConfigs?.[path] ?? options.stores?.[path];
        return { exists: Boolean(data), data: () => data };
      }),
    })),
    collection: jest.fn((collectionName: string) => {
      if (collectionName === 'groupProductConfig') {
        let selectedIds: string[] = [];
        const query = {
          where: jest.fn((field: string, op: string, ids: string[]) => {
            groupWhereCalls.push([field, op, ids]);
            selectedIds = ids;
            return query;
          }),
          get: jest.fn(async () => ({
            docs: configs
              .filter((config) => selectedIds.includes(config['productId'] as string))
              .map((config) => ({ data: () => config })),
          })),
        };
        return query;
      }

      return {
        where: jest.fn().mockReturnThis(),
        get: jest.fn(async () => ({
          docs: products.map((product) => ({ data: () => product })),
        })),
      };
    }),
  };
}
