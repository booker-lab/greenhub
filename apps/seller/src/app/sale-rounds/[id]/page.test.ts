import type { Product } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import type { SellerSaleRound } from '@/hooks/useSaleRounds';
import { buildRoundPageData, getRoundAction, readSafeRoundId } from './page.logic';

const ROUND: SellerSaleRound = {
  id: 'round-a',
  storeId: 'store-a',
  name: '7월 넷째 주 회차',
  status: 'DRAFT',
  closeReason: null,
  cancellation: null,
  schedule: {
    orderOpenAt: '2026-07-18T15:00:00.000Z',
    orderCloseAt: '2026-07-19T15:00:00.000Z',
    auctionAt: '2026-07-20T00:00:00.000Z',
    deliveryStartAt: '2026-07-20T15:00:00.000Z',
    deliveryEndAt: '2026-07-21T00:00:00.000Z',
    timezone: 'Asia/Seoul',
  },
  deliveryRegion: {
    id: 'icheon',
    label: '경기도 이천시',
    province: '경기도',
    city: '이천시',
    enabled: true,
  },
  limits: { maxDeliveryAddresses: 15, maxItemQuantity: 30 },
  counters: {
    reservedDeliveryAddresses: 0,
    reservedItemQuantity: 0,
    orderedDeliveryAddresses: 0,
    orderedItemQuantity: 0,
    heldOrderCount: 0,
  },
  carrotLandingUrl: 'https://greenlove.co.kr/?round=round-a',
  cancelledAt: null,
  completedAt: null,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
  items: [
    {
      id: 'item-a',
      roundId: 'round-a',
      storeId: 'store-a',
      productId: 'product-a',
      productNameSnapshot: '호접란 A',
      productImageUrlSnapshot: null,
      roundPrice: 39_000,
      saleLimitQuantity: 30,
      reservedQuantity: 0,
      orderedQuantity: 0,
      displayOrder: 0,
      status: 'ACTIVE',
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
    },
  ],
};

const PRODUCT: Product = {
  id: 'product-a',
  storeId: 'store-a',
  name: '호접란 A',
  images: [],
  price: 45_000,
  category: 'orchid',
  saleType: 'normal',
  deliverySize: 'medium',
  isActive: true,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

describe('판매 회차 상세 라우트 경계', () => {
  it('안전한 단일 회차 식별자만 허용한다', () => {
    expect(readSafeRoundId('round_2026-07')).toBe('round_2026-07');
    expect(readSafeRoundId(['round-a'])).toBeNull();
    expect(readSafeRoundId('round/a')).toBeNull();
    expect(readSafeRoundId('round a')).toBeNull();
    expect(readSafeRoundId(`round\u0000a`)).toBeNull();
    expect(readSafeRoundId('r'.repeat(129))).toBeNull();
  });

  it.each([
    ['DRAFT', 'schedule'],
    ['SCHEDULED', null],
    ['OPEN', 'close'],
    ['CLOSED', 'complete'],
    ['COMPLETED', null],
    ['CANCELLED', null],
  ] as const)('%s 상태에는 허용된 상세 동작만 제공한다', (status, action) => {
    expect(getRoundAction(status)).toBe(action);
  });

  it('검증된 회차와 현재 스토어 상품으로 당근 링크를 구성한다', () => {
    const otherStoreProduct = { ...PRODUCT, id: 'product-other', storeId: 'store-b' };
    const result = buildRoundPageData(ROUND, [PRODUCT, otherStoreProduct]);

    expect(result.products).toEqual([PRODUCT]);
    expect(result.carrotLinks.representativeUrl).toBe(
      'https://greenlove.co.kr/?round=round-a&utm_source=carrot',
    );
    expect(result.carrotLinks.productLinks).toEqual([
      {
        productId: 'product-a',
        url: 'https://greenlove.co.kr/products/product-a?round=round-a&utm_source=carrot',
      },
    ]);
  });

  it.each([
    'javascript:alert(1)',
    'https://evil.example/?round=round-a',
    'https://greenlove.co.kr/products/product-a?round=round-a',
    'https://greenlove.co.kr/?round=round-b',
    'https://greenlove.co.kr/\u0000?round=round-a',
  ])('허용되지 않은 대표 링크 %s를 거부한다', (carrotLandingUrl) => {
    expect(() => buildRoundPageData({ ...ROUND, carrotLandingUrl }, [PRODUCT])).toThrow(
      /당근 대표 링크/,
    );
  });

  it('중복 회차 상품 식별자를 손상 응답으로 거부한다', () => {
    const duplicateItem = { ...ROUND.items[0], id: 'item-b' };
    expect(() =>
      buildRoundPageData({ ...ROUND, items: [...ROUND.items, duplicateItem] }, [PRODUCT]),
    ).toThrow('회차 상품 식별자 응답이 올바르지 않습니다.');
  });

  it('중복되거나 손상된 현재 스토어 상품을 폼 데이터로 승격하지 않는다', () => {
    expect(() => buildRoundPageData(ROUND, [PRODUCT, { ...PRODUCT }])).toThrow(
      '스토어 상품 응답이 올바르지 않습니다.',
    );
    expect(() => buildRoundPageData(ROUND, [{ ...PRODUCT, id: 'product/a' }])).toThrow(
      '스토어 상품 응답이 올바르지 않습니다.',
    );
  });
});
