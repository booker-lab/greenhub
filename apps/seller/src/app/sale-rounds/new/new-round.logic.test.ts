import type { Product } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import type { CreateSaleRoundInput } from '@/hooks/useSaleRounds';
import { validateRoundFormInput } from '../[id]/RoundForm.logic';
import {
  buildNewRoundTemplate,
  DEFAULT_DELIVERY_REGION,
  defaultRoundName,
  nextRoundSchedule,
} from './new-round.logic';

// KST 시각을 UTC Date로 만든다.
const kst = (iso: string) => new Date(`${iso}+09:00`);
const toKstLocal = (iso: string) =>
  new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16);

function product(overrides: Partial<Product>): Product {
  return {
    id: 'p',
    storeId: 'store-1',
    name: '상품',
    images: ['https://example.test/p.jpg'],
    price: 30000,
    saleType: 'normal',
    isActive: true,
    ...overrides,
  } as Product;
}

describe('새 회차 기본 일정', () => {
  it('월요일 오후에는 그 주 목요일 10:00 시작·일요일 24:00 마감·월 07:00 경매·화 00:00~09:00 배송', () => {
    const schedule = nextRoundSchedule(kst('2026-09-28T17:00:00'));

    expect(toKstLocal(schedule.orderOpenAt)).toBe('2026-10-01T10:00');
    expect(toKstLocal(schedule.orderCloseAt)).toBe('2026-10-05T00:00');
    expect(toKstLocal(schedule.auctionAt)).toBe('2026-10-05T07:00');
    expect(toKstLocal(schedule.deliveryStartAt)).toBe('2026-10-06T00:00');
    expect(toKstLocal(schedule.deliveryEndAt)).toBe('2026-10-06T09:00');
    expect(schedule.timezone).toBe('Asia/Seoul');
  });

  it('주문 시작까지 1시간 이하로 남으면 다음 주기로 넘긴다', () => {
    const schedule = nextRoundSchedule(kst('2026-10-01T09:30:00'));

    expect(toKstLocal(schedule.orderOpenAt)).toBe('2026-10-08T10:00');
    expect(toKstLocal(schedule.orderCloseAt)).toBe('2026-10-12T00:00');
  });

  it('일요일 밤(KST)에도 다음 주 목요일 시작 주기를 고른다', () => {
    // UTC로는 일요일 14:30이지만 KST로는 일요일 23:30이다.
    const schedule = nextRoundSchedule(kst('2026-10-04T23:30:00'));

    expect(toKstLocal(schedule.orderOpenAt)).toBe('2026-10-08T10:00');
    expect(toKstLocal(schedule.orderCloseAt)).toBe('2026-10-12T00:00');
  });

  it('배송일 기준으로 회차 이름을 만든다', () => {
    expect(defaultRoundName(nextRoundSchedule(kst('2026-09-28T17:00:00')))).toBe(
      '10월 6일 배송 회차',
    );
  });
});

describe('새 회차 템플릿', () => {
  const products = [
    product({ id: 'normal-1', name: '만천홍', price: 25000 }),
    product({ id: 'group-1', name: 'k9', saleType: 'group' }),
    product({ id: 'inactive-1', name: '비활성', isActive: false }),
    product({ id: 'normal-2', name: '빅립', price: 30000, images: [] }),
  ];

  it('활성 일반 판매 상품만 현재 가격·한도 10개·순서대로 넣고 공동구매·비활성은 뺀다', () => {
    const round = buildNewRoundTemplate(products, 'store-1', kst('2026-09-28T17:00:00'));

    expect(round.status).toBe('DRAFT');
    expect(round.deliveryRegion).toEqual(DEFAULT_DELIVERY_REGION);
    expect(round.limits).toEqual({ maxDeliveryAddresses: 15, maxItemQuantity: 30 });
    expect(
      round.items.map(({ productId, roundPrice, saleLimitQuantity, displayOrder }) => ({
        productId,
        roundPrice,
        saleLimitQuantity,
        displayOrder,
      })),
    ).toEqual([
      { productId: 'normal-1', roundPrice: 25000, saleLimitQuantity: 10, displayOrder: 0 },
      { productId: 'normal-2', roundPrice: 30000, saleLimitQuantity: 10, displayOrder: 1 },
    ]);
    expect(round.items[1]?.productImageUrlSnapshot).toBeNull();
  });

  it('템플릿 값은 회차 양식 검증을 그대로 통과한다', () => {
    const round = buildNewRoundTemplate(products, 'store-1', kst('2026-09-28T17:00:00'));
    const input: CreateSaleRoundInput = {
      name: round.name,
      schedule: round.schedule,
      deliveryRegion: round.deliveryRegion,
      limits: round.limits,
      items: round.items.map(({ productId, roundPrice, saleLimitQuantity, displayOrder }) => ({
        productId,
        roundPrice,
        saleLimitQuantity,
        displayOrder,
      })),
    };

    expect(validateRoundFormInput(input)).toEqual([]);
  });
});
