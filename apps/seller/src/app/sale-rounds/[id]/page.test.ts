import type { Product } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import type { SellerSaleRound } from '@/hooks/useSaleRounds';
import {
  buildRoundPageData,
  getRoundAction,
  isRoundCancelConfirmationValid,
  isRoundEditable,
  readSafeRoundId,
  resolveRoundCancelAction,
  resolveRoundCancellationProgress,
} from './page.logic';

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

  it.each([
    ['DRAFT', true],
    ['SCHEDULED', true],
    ['OPEN', false],
    ['CLOSED', false],
    ['COMPLETED', false],
    ['CANCELLED', false],
  ] as const)('%s 회차는 서버 수정 허용과 같게 편집 가능 여부를 정한다', (status, editable) => {
    expect(isRoundEditable({ status, cancellation: null })).toBe(editable);
  });

  it('취소가 걸린 회차는 판매 예정이어도 읽기 전용이다', () => {
    expect(
      isRoundEditable({
        status: 'SCHEDULED',
        cancellation: {
          status: 'LOCAL_FAILED',
          reason: '확인 필요',
          failedOrderId: null,
          updatedAt: '2026-11-01T00:00:00.000Z',
          completedAt: null,
        },
      }),
    ).toBe(false);
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

describe('회차 취소(관리자 전용)', () => {
  const NOW = Date.parse('2026-11-09T01:00:00.000Z');
  const cancellation = (
    status: 'CANCELLING' | 'LOCAL_FAILED' | 'COMPLETED',
    leaseExpiresAt: string | null = null,
  ) => ({
    status,
    reason: '판매 회차 취소',
    failedOrderId: null,
    leaseExpiresAt,
    updatedAt: '2026-11-09T00:59:00.000Z',
    completedAt: null,
  });

  it('관리자만, 서버가 취소를 받는 상태에서만 버튼이 보인다', () => {
    for (const status of ['DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED'] as const) {
      expect(resolveRoundCancelAction({ status, cancellation: null }, 'admin', NOW)).toBe('cancel');
      expect(resolveRoundCancelAction({ status, cancellation: null }, 'seller', NOW)).toBeNull();
    }
    for (const status of ['COMPLETED', 'CANCELLED'] as const) {
      expect(resolveRoundCancelAction({ status, cancellation: null }, 'admin', NOW)).toBeNull();
    }
    expect(resolveRoundCancelAction({ status: 'OPEN', cancellation: null }, null, NOW)).toBeNull();
  });

  it('멈춘 취소(LOCAL_FAILED·lease 만료)는 "다시 진행", 진행 중이면 버튼을 숨긴다', () => {
    const failed = { status: 'CLOSED' as const, cancellation: cancellation('LOCAL_FAILED') };
    expect(resolveRoundCancellationProgress(failed, NOW)).toBe('STUCK');
    expect(resolveRoundCancelAction(failed, 'admin', NOW)).toBe('resume');
    expect(resolveRoundCancelAction(failed, 'seller', NOW)).toBeNull();

    const running = {
      status: 'OPEN' as const,
      cancellation: cancellation('CANCELLING', '2026-11-09T01:04:00.000Z'),
    };
    expect(resolveRoundCancellationProgress(running, NOW)).toBe('RUNNING');
    expect(resolveRoundCancelAction(running, 'admin', NOW)).toBeNull();

    const expired = {
      status: 'OPEN' as const,
      cancellation: cancellation('CANCELLING', '2026-11-09T00:55:00.000Z'),
    };
    expect(resolveRoundCancellationProgress(expired, NOW)).toBe('STUCK');
    expect(resolveRoundCancelAction(expired, 'admin', NOW)).toBe('resume');

    expect(
      resolveRoundCancellationProgress(
        { status: 'CANCELLED', cancellation: cancellation('COMPLETED') },
        NOW,
      ),
    ).toBe('NONE');
  });

  it('회차 이름을 그대로 입력해야 취소할 수 있다(앞뒤 공백만 무시)', () => {
    expect(isRoundCancelConfirmationValid('11월 10일 배송 회차', '11월 10일 배송 회차')).toBe(true);
    expect(isRoundCancelConfirmationValid(' 11월 10일 배송 회차 ', '11월 10일 배송 회차')).toBe(
      true,
    );
    expect(isRoundCancelConfirmationValid('11월 10일 배송', '11월 10일 배송 회차')).toBe(false);
    expect(isRoundCancelConfirmationValid('11월10일 배송 회차', '11월 10일 배송 회차')).toBe(false);
    expect(isRoundCancelConfirmationValid('', '')).toBe(false);
  });
});
