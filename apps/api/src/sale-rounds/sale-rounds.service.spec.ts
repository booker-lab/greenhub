import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { SaleRound } from '@greenhub/shared';
import { SaleRoundsService } from './sale-rounds.service';

type Data = Record<string, any>;

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
      limits: { maxDeliveryAddresses: 15, maxItemQuantity: 30 },
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

  function timestamp(iso: string) {
    return { _seconds: new Date(iso).getTime() / 1000, toDate: () => new Date(iso) };
  }

  function makeService(extra: Record<string, Data> = {}, round = makeRound()) {
    const records = new Map<string, Data>([
      ['stores/store-1', { id: 'store-1', ownerId: 'seller-1' }],
      ['saleRounds/round-1', round as unknown as Data],
      ...Object.entries(extra),
    ]);
    const writes: Array<{ path: string; data: Data }> = [];
    const doc = (path: string) => ({
      get: jest.fn(async () => ({
        exists: records.has(path),
        data: () => records.get(path),
      })),
      update: jest.fn(async (data: Data) => {
        writes.push({ path, data });
        records.set(path, { ...(records.get(path) ?? {}), ...data });
      }),
      set: jest.fn(async (data: Data) => records.set(path, data)),
      delete: jest.fn(async () => records.delete(path)),
      path,
    });
    const collection = (name: string) => {
      const filters: Array<[string, string, unknown]> = [];
      const query = {
        where(field: string, op: string, value: unknown) {
          filters.push([field, op, value]);
          return query;
        },
        async get() {
          const docs = Array.from(records.entries())
            .filter(([path]) => path.startsWith(`${name}/`))
            .map(([path, data]) => ({ id: path.split('/')[1], data: () => data, ref: doc(path) }))
            .filter((snap) =>
              filters.every(([field, op, value]) => {
                const actual = snap.data()[field];
                return op === 'in' ? (value as unknown[]).includes(actual) : actual === value;
              }),
            );
          return { docs, empty: docs.length === 0, size: docs.length };
        },
      };
      return query;
    };
    const tx = {
      get: jest.fn((ref: { get: () => Promise<unknown> }) => ref.get()),
      update: jest.fn((ref: { update: (data: Data) => Promise<void> }, data: Data) => ref.update(data)),
      set: jest.fn((ref: { set: (data: Data) => Promise<void> }, data: Data) => ref.set(data)),
      delete: jest.fn((ref: { delete: () => Promise<void> }) => ref.delete()),
    };
    const firestore = {
      doc,
      collection,
      runTransaction: jest.fn((callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
      Timestamp: { now: jest.fn(() => now) },
    };
    const payments = { processRefundByOrderId: jest.fn().mockResolvedValue(undefined) };
    const service = new (SaleRoundsService as any)(firestore, payments) as SaleRoundsService;
    return { service, payments, records, writes };
  }

  it('주문 시작·마감·한도 도달 상태를 순서대로 자동 전환한다', async () => {
    const opened = makeService();
    await expect(opened.service.refreshRoundStatus('store-1', 'round-1')).resolves.toMatchObject({
      status: 'OPEN',
    });

    const closed = makeService({}, makeRound({
      status: 'OPEN',
      schedule: { ...makeRound().schedule, orderCloseAt: '2026-07-14T00:00:00.000+09:00' },
    }));
    await expect(closed.service.refreshRoundStatus('store-1', 'round-1')).resolves.toMatchObject({
      status: 'CLOSED',
    });

    const full = makeService({}, makeRound({
      status: 'OPEN',
      counters: { ...makeRound().counters, reservedDeliveryAddresses: 2, orderedDeliveryAddresses: 13 },
    }));
    await expect(full.service.refreshRoundStatus('store-1', 'round-1')).resolves.toMatchObject({
      status: 'CLOSED',
    });
  });

  it('다른 판매자의 회차 쓰기를 거부하고 관리자는 허용한다', async () => {
    const { service, writes } = makeService();
    await expect(
      (service as any).updateStatus('store-1', 'round-1', 'seller-2', 'seller', { status: 'OPEN' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toHaveLength(0);

    await expect(
      (service as any).updateStatus('store-1', 'round-1', 'admin-1', 'admin', { status: 'OPEN' }),
    ).resolves.toMatchObject({ status: 'OPEN' });
  });

  it('회차 상태 역전과 순서 건너뛰기를 거부한다', async () => {
    const { service, writes } = makeService({}, makeRound({ status: 'OPEN' }));
    await expect(
      (service as any).updateStatus('store-1', 'round-1', 'seller-1', 'seller', {
        status: 'SCHEDULED',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(writes).toHaveLength(0);
  });

  it('배송 보류 또는 미완료 주문이 남아 있으면 완료를 차단한다', async () => {
    const held = makeService({}, makeRound({
      status: 'CLOSED',
      counters: { ...makeRound().counters, heldOrderCount: 1 },
    }));
    await expect(
      (held.service as any).completeRound('store-1', 'round-1', 'seller-1', 'seller'),
    ).rejects.toBeInstanceOf(ConflictException);

    const pending = makeService(
      { 'orders/order-1': { id: 'order-1', roundId: 'round-1', status: 'PREPARING' } },
      makeRound({ status: 'CLOSED' }),
    );
    await expect(
      (pending.service as any).completeRound('store-1', 'round-1', 'seller-1', 'seller'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('회차 취소는 결제 주문을 한 번만 환불하고 중복 호출을 멱등 처리한다', async () => {
    const { service, payments } = makeService({
      'orders/order-1': { id: 'order-1', roundId: 'round-1', status: 'ACCEPTED' },
      'orders/order-2': { id: 'order-2', roundId: 'round-1', status: 'PENDING' },
    }, makeRound({ status: 'OPEN' }));

    await (service as any).updateStatus('store-1', 'round-1', 'seller-1', 'seller', {
      status: 'CANCELLED',
    });
    await (service as any).updateStatus('store-1', 'round-1', 'seller-1', 'seller', {
      status: 'CANCELLED',
    });

    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(payments.processRefundByOrderId).toHaveBeenCalledWith('order-1', '판매 회차 취소');
  });

  it('Firestore Timestamp를 ISO8601로 정규화한 뒤 최신순으로 정렬한다', async () => {
    const { service } = makeService({
      'saleRounds/round-1': { ...makeRound(), createdAt: timestamp('2026-07-10T00:00:00.000Z') },
      'saleRounds/round-2': { ...makeRound({ id: 'round-2' }), createdAt: timestamp('2026-07-12T00:00:00.000Z') },
    });

    await expect(service.listSellerRounds('store-1')).resolves.toMatchObject({
      items: [
        { id: 'round-2', createdAt: '2026-07-12T00:00:00.000Z' },
        { id: 'round-1', createdAt: '2026-07-10T00:00:00.000Z' },
      ],
    });
  });
});
