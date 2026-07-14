import { ConflictException } from '@nestjs/common';
import type { SaleRound } from '@greenhub/shared';
import { SaleRoundsService } from './sale-rounds.service';

describe('SaleRoundsService', () => {
  const now = new Date('2026-07-14T00:30:00.000+09:00');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  function makeRound(overrides: Partial<SaleRound> = {}): SaleRound {
    return {
      id: 'round-1',
      storeId: 'store-1',
      name: '7월 3주차 호접란',
      status: 'SCHEDULED',
      schedule: {
        orderOpenAt: '2026-07-13T00:00:00.000+09:00',
        orderCloseAt: '2026-07-20T00:00:00.000+09:00',
        auctionAt: '2026-07-20T09:00:00.000+09:00',
        deliveryStartAt: '2026-07-21T00:00:00.000+09:00',
        deliveryEndAt: '2026-07-21T09:00:00.000+09:00',
        timezone: 'Asia/Seoul',
      },
      deliveryRegion: {
        id: 'icheon',
        label: '경기도 이천시',
        province: '경기도',
        city: '이천시',
        enabled: true,
      },
      limits: {
        maxDeliveryAddresses: 15,
        maxItemQuantity: 30,
      },
      counters: {
        reservedDeliveryAddresses: 0,
        reservedItemQuantity: 0,
        orderedDeliveryAddresses: 0,
        orderedItemQuantity: 0,
        heldOrderCount: 0,
      },
      carrotLandingUrl: null,
      cancelledAt: null,
      completedAt: null,
      createdAt: '2026-07-10T00:00:00.000+09:00',
      updatedAt: '2026-07-10T00:00:00.000+09:00',
      ...overrides,
    };
  }

  function makeService(round: SaleRound) {
    const update = jest.fn().mockResolvedValue(undefined);
    const roundRef = {
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => round,
      }),
      update,
    };
    const firestore = {
      doc: jest.fn((path: string) => {
        if (path === `saleRounds/${round.id}`) return roundRef;
        throw new Error(`예상하지 못한 문서 경로: ${path}`);
      }),
      Timestamp: {
        now: jest.fn(() => now),
      },
    };
    const service = new SaleRoundsService(firestore as never);
    return { firestore, roundRef, service, update };
  }

  describe('refreshRoundStatus', () => {
    it('주문 시작 시각이 지나면 예정 회차를 판매 중으로 자동 전환한다', async () => {
      const { service, update } = makeService(makeRound());

      await expect(service.refreshRoundStatus('store-1', 'round-1')).resolves.toMatchObject({
        id: 'round-1',
        status: 'OPEN',
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'OPEN',
          updatedAt: now,
        }),
      );
    });

    it('주문 마감 시각이 지나면 판매 중 회차를 주문 마감으로 자동 전환한다', async () => {
      const { service, update } = makeService(
        makeRound({
          status: 'OPEN',
          schedule: {
            ...makeRound().schedule,
            orderCloseAt: '2026-07-14T00:00:00.000+09:00',
          },
        }),
      );

      await expect(service.refreshRoundStatus('store-1', 'round-1')).resolves.toMatchObject({
        status: 'CLOSED',
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'CLOSED',
          updatedAt: now,
        }),
      );
    });

    it('예약 수량을 포함한 배송지 한도에 도달하면 회차를 주문 마감으로 전환한다', async () => {
      const { service, update } = makeService(
        makeRound({
          status: 'OPEN',
          counters: {
            reservedDeliveryAddresses: 2,
            reservedItemQuantity: 0,
            orderedDeliveryAddresses: 13,
            orderedItemQuantity: 0,
            heldOrderCount: 0,
          },
        }),
      );

      await expect(service.refreshRoundStatus('store-1', 'round-1')).resolves.toMatchObject({
        status: 'CLOSED',
      });

      expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'CLOSED' }));
    });
  });

  describe('completeRound', () => {
    it('배송 보류 주문이 남아 있으면 회차 완료를 차단한다', async () => {
      const { service, update } = makeService(
        makeRound({
          status: 'CLOSED',
          counters: {
            reservedDeliveryAddresses: 0,
            reservedItemQuantity: 0,
            orderedDeliveryAddresses: 10,
            orderedItemQuantity: 20,
            heldOrderCount: 1,
          },
        }),
      );

      await expect(service.completeRound('store-1', 'round-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(update).not.toHaveBeenCalled();
    });
  });
});
