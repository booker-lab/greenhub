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
});

function createPublicProductsFirestore(
  products: Record<string, unknown>[],
  configs: Record<string, unknown>[],
  groupWhereCalls: unknown[][],
) {
  return {
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
