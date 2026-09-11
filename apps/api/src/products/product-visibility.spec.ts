import {
  isPubliclyVisibleProduct,
  toPublicGroupConfig,
  toPublicGroupSummary,
  toPublicProductDetail,
  toPublicProductSummary,
} from './product-visibility';

describe('public visibility canonical predicate', () => {
  it('isActive true + testOnly not true만 공개한다', () => {
    expect(isPubliclyVisibleProduct({ isActive: true } as never)).toBe(true);
    expect(isPubliclyVisibleProduct({ isActive: true, testOnly: false } as never)).toBe(true);
    expect(isPubliclyVisibleProduct({ isActive: false } as never)).toBe(false);
    expect(isPubliclyVisibleProduct({ isActive: true, testOnly: true } as never)).toBe(false);
    expect(isPubliclyVisibleProduct({} as never)).toBe(false);
    expect(isPubliclyVisibleProduct(null)).toBe(false);
  });
});

describe('public product projection', () => {
  const stored = {
    id: 'p-1',
    storeId: 's-1',
    name: '공개 상품',
    images: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    price: 10000,
    category: 'cut_flower',
    saleType: 'normal',
    deliverySize: 'small',
    isActive: true,
    testOnly: false,
    sellerNote: '내부 메모',
    sellerOverride: true,
    content: { headline: '제목', description: '설명', isEditedByUser: true },
    varietyId: 'v-1',
    selection: { colors: ['레드'] },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  };

  it('detail에서 내부 필드를 제거한다', () => {
    const detail = toPublicProductDetail(stored as never, null) as Record<string, unknown>;
    expect(detail).not.toHaveProperty('sellerNote');
    expect(detail).not.toHaveProperty('sellerOverride');
    expect(detail).not.toHaveProperty('testOnly');
    expect(detail['content']).toEqual({ headline: '제목', description: '설명' });
    expect(detail['id']).toBe('p-1');
    expect(detail['storeId']).toBe('s-1');
    expect(detail['varietyId']).toBe('v-1');
  });

  it('summary는 allowlist만 반환하고 원문을 spread하지 않는다', () => {
    const summary = toPublicProductSummary(stored as never, null) as Record<string, unknown>;
    expect(Object.keys(summary).sort()).toEqual(
      ['category', 'colors', 'id', 'images', 'isActive', 'name', 'price', 'saleType'].sort(),
    );
    expect(summary).not.toHaveProperty('sellerNote');
    expect(summary).not.toHaveProperty('content');
    expect(summary['images']).toEqual(['https://example.com/a.jpg']);
  });

  it('group summary/detail에서 isProcessed를 제거한다', () => {
    const gc = {
      productId: 'p-1',
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
    const summary = toPublicGroupSummary(gc as never);
    expect(summary).not.toHaveProperty('isProcessed');
    expect(summary).toEqual({
      currentQuantity: 3,
      minQuantity: 5,
      targetQuantity: 10,
      recruitDeadline: '2026-09-10T00:00:00.000Z',
    });

    const config = toPublicGroupConfig(gc as never) as unknown as Record<string, unknown>;
    expect(config).not.toHaveProperty('isProcessed');
    expect(config['productId']).toBe('p-1');
    expect(config['currentQuantity']).toBe(3);
  });

  it('Firestore Timestamp를 ISO로 정규화한다', () => {
    const gc = {
      productId: 'p-1',
      minQuantity: 1,
      targetQuantity: 2,
      maxPerPerson: 1,
      recruitDeadline: { toDate: () => new Date('2026-09-10T00:00:00.000Z') },
      currentQuantity: 0,
      groupDeliveryDate: { toDate: () => new Date('2026-09-15T00:00:00.000Z') },
      groupDeliveryMethod: 'direct',
      deliveryFeeDiscount: 0,
      isProcessed: false,
    };
    const config = toPublicGroupConfig(gc as never) as unknown as Record<string, unknown>;
    expect(config['recruitDeadline']).toBe('2026-09-10T00:00:00.000Z');
    expect(config['groupDeliveryDate']).toBe('2026-09-15T00:00:00.000Z');
  });
});
