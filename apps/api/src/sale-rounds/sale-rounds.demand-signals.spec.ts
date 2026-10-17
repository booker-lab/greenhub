import {
  type PublicSaleRoundWithItems,
  remainingRoundItemQuantity,
  withDemandSignals,
} from './sale-rounds.service';

describe('공개 회차 수요 신호(벤치마킹 비교 기능)', () => {
  it('남은 수량은 한도에서 결제 대기·주문 수량을 빼고 0 밑으로 내려가지 않는다', () => {
    expect(
      remainingRoundItemQuantity({ saleLimitQuantity: 10, reservedQuantity: 2, orderedQuantity: 3 }),
    ).toBe(5);
    expect(
      remainingRoundItemQuantity({ saleLimitQuantity: 10, reservedQuantity: 6, orderedQuantity: 7 }),
    ).toBe(0);
  });

  it('공개 응답에 남은 수량과 구매 배송지 수만 더하고 원래 수량 필드는 내보내지 않는다', () => {
    const projected = {
      id: 'r-1',
      storeId: 's-1',
      name: '회차',
      status: 'OPEN',
      closeReason: null,
      schedule: {} as never,
      deliveryRegion: {} as never,
      limits: {} as never,
      carrotLandingUrl: null,
      items: [
        {
          id: 'i-1',
          roundId: 'r-1',
          storeId: 's-1',
          productId: 'p-1',
          productNameSnapshot: '빅립',
          productImageUrlSnapshot: null,
          roundPrice: 30000,
          saleLimitQuantity: 10,
          displayOrder: 0,
          status: 'ACTIVE',
        },
      ],
    } as PublicSaleRoundWithItems;
    const stored = [
      { id: 'i-1', saleLimitQuantity: 10, reservedQuantity: 1, orderedQuantity: 6 },
    ] as never;
    const result = withDemandSignals(
      projected,
      { counters: { orderedDeliveryAddresses: 7 } as never },
      stored,
    );
    expect(result.demand).toEqual({ buyerCount: 7 });
    expect(result.items[0].demand).toEqual({ remainingQuantity: 3 });
    expect(result.items[0]).not.toHaveProperty('orderedQuantity');
    expect(result.items[0]).not.toHaveProperty('reservedQuantity');
  });
});
