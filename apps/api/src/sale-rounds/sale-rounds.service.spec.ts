import type { SaleRound } from '@greenhub/shared';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SaleRoundStateService } from './sale-round-state.service';
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
      closeReason: null,
      cancellation: null,
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

  function makeItem(overrides: Data = {}) {
    return {
      id: 'item-1',
      roundId: 'round-1',
      storeId: 'store-1',
      productId: 'product-1',
      productNameSnapshot: '공개 상품',
      productImageUrlSnapshot: null,
      roundPrice: 10000,
      saleLimitQuantity: 3,
      reservedQuantity: 0,
      orderedQuantity: 0,
      displayOrder: 0,
      status: 'ACTIVE',
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
      ...overrides,
    };
  }

  function makeService(extra: Record<string, Data> = {}, round = makeRound()) {
    const records = new Map<string, Data>([
      ['stores/store-1', { id: 'store-1', ownerId: 'seller-1', salesMode: 'round_direct' }],
      ['saleRounds/round-1', round as unknown as Data],
      ...Object.entries(extra),
    ]);
    const writes: Array<{ path: string; data: Data }> = [];
    const collectionCalls: Array<{ name: string; filters: Array<[string, string, unknown]> }> = [];
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
      collectionCalls.push({ name, filters });
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
      update: jest.fn((ref: { update: (data: Data) => Promise<void> }, data: Data) =>
        ref.update(data),
      ),
      set: jest.fn((ref: { set: (data: Data) => Promise<void> }, data: Data) => ref.set(data)),
      delete: jest.fn((ref: { delete: () => Promise<void> }) => ref.delete()),
    };
    const firestore = {
      doc,
      collection,
      runTransaction: jest.fn((callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
      Timestamp: { now: jest.fn(() => now) },
    };
    const roundLifecycle = {
      cancelForRound: jest.fn(async ({ orderId }: { orderId: string }) => {
        const order = records.get(`orders/${orderId}`);
        records.set(`orders/${orderId}`, {
          ...order,
          status: 'CANCELLED',
          cancellation: { status: 'COMPLETED' },
        });
      }),
    };
    const roundState = new SaleRoundStateService(firestore as never, roundLifecycle as never);
    const service = new (SaleRoundsService as any)(firestore, roundState) as SaleRoundsService;
    return { service, roundLifecycle, records, writes, firestore, collectionCalls };
  }

  it('판매자 목록·상세 조회는 실제 소유 스토어에만 허용하고 관리자는 허용한다', async () => {
    const { service } = makeService();

    await expect(
      (service as any).listSellerRounds('store-1', 'seller-2', 'seller'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      (service as any).getRound('store-1', 'round-1', 'seller-2', 'seller'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      (service as any).listSellerRounds('store-1', 'admin-1', 'admin'),
    ).resolves.toMatchObject({ items: [{ id: 'round-1' }] });
  });

  it.each([
    ['legacy', { salesMode: 'legacy' }],
    ['missing', {}],
    ['null', { salesMode: null }],
    ['invalid', { salesMode: 'unsupported' }],
  ])('public detail은 %s salesMode를 refresh 전에 거부한다', async (_label, storeFields) => {
    const { service, firestore, collectionCalls } = makeService({
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1', ...storeFields },
    });
    const refresh = jest.spyOn(service, 'refreshRoundStatus');

    await expect(service.getPublicRound('store-1', 'round-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(firestore.runTransaction).not.toHaveBeenCalled();
    expect(collectionCalls).toHaveLength(0);
  });

  it.each([
    ['legacy', { salesMode: 'legacy' }],
    ['missing', {}],
    ['null', { salesMode: null }],
    ['invalid', { salesMode: 'unsupported' }],
  ])('public list은 %s salesMode를 round query 전에 거부한다', async (_label, storeFields) => {
    const { service, firestore, collectionCalls } = makeService({
      'stores/store-1': { id: 'store-1', ownerId: 'seller-1', ...storeFields },
    });
    const refresh = jest.spyOn(service, 'refreshRoundStatus');

    await expect(service.listPublicRounds('store-1')).rejects.toBeInstanceOf(NotFoundException);

    expect(refresh).not.toHaveBeenCalled();
    expect(firestore.runTransaction).not.toHaveBeenCalled();
    expect(collectionCalls).toHaveLength(0);
  });

  it('public 목록·상세는 존재하지 않는 store를 round query와 refresh 전에 거부한다', async () => {
    const { service, firestore, collectionCalls } = makeService();
    const refresh = jest.spyOn(service, 'refreshRoundStatus');

    await expect(service.listPublicRounds('store-missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getPublicRound('store-missing', 'round-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(firestore.runTransaction).not.toHaveBeenCalled();
    expect(collectionCalls).toHaveLength(0);
  });

  it.each(['SCHEDULED', 'OPEN', 'CLOSED', 'COMPLETED'])(
    'public detail은 %s 상태를 허용하고 matching item query를 수행한다', async (status) => {
      const { service, collectionCalls } = makeService(
        { 'saleRoundItems/item-1': makeItem() },
        makeRound({ status: status as SaleRound['status'] }),
      );

      await expect(service.getPublicRound('store-1', 'round-1')).resolves.toMatchObject({
        storeId: 'store-1',
        items: [{ id: 'item-1', storeId: 'store-1' }],
      });
      expect(collectionCalls.filter(({ name }) => name === 'saleRoundItems')).toHaveLength(1);
    },
  );

  it.each(['DRAFT', 'CANCELLED', 'UNKNOWN'])(
    'public detail은 %s 상태를 item query 전에 fail closed한다', async (status) => {
      const { service, firestore, collectionCalls } = makeService(
        { 'saleRoundItems/item-1': makeItem() },
        makeRound({ status: status as SaleRound['status'] }),
      );
      const refresh = jest.spyOn(service, 'refreshRoundStatus');

      await expect(service.getPublicRound('store-1', 'round-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(refresh).not.toHaveBeenCalled();
      expect(firestore.runTransaction).not.toHaveBeenCalled();
      expect(collectionCalls.filter(({ name }) => name === 'saleRoundItems')).toHaveLength(0);
    },
  );

  it('public detail은 parent round와 matching하는 store item만 반환한다', async () => {
    const { service } = makeService(
      {
        'saleRoundItems/item-1': makeItem(),
        'saleRoundItems/item-foreign': makeItem({ id: 'item-foreign', storeId: 'store-2' }),
      },
      makeRound({ status: 'OPEN' }),
    );

    await expect(service.getPublicRound('store-1', 'round-1')).resolves.toMatchObject({
      items: [{ id: 'item-1', storeId: 'store-1' }],
    });
  });

  it('public detail은 requested store와 parent round store가 다르면 refresh 전에 거부한다', async () => {
    const { service, firestore, collectionCalls } = makeService(
      { 'saleRoundItems/item-1': makeItem() },
      makeRound({ status: 'OPEN', storeId: 'store-2' }),
    );
    const refresh = jest.spyOn(service, 'refreshRoundStatus');

    await expect(service.getPublicRound('store-1', 'round-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(firestore.runTransaction).not.toHaveBeenCalled();
    expect(collectionCalls.filter(({ name }) => name === 'saleRoundItems')).toHaveLength(0);
  });

  it('public detail은 존재하지 않는 parent round를 refresh 전에 거부한다', async () => {
    const { service, records, firestore, collectionCalls } = makeService();
    records.delete('saleRounds/round-1');
    const refresh = jest.spyOn(service, 'refreshRoundStatus');

    await expect(service.getPublicRound('store-1', 'round-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(firestore.runTransaction).not.toHaveBeenCalled();
    expect(collectionCalls).toHaveLength(0);
  });

  it('seller update는 foreign-store item을 보존하고 matching item만 교체한다', async () => {
    const { service, records } = makeService({
      'products/product-1': { storeId: 'store-1', name: '공개 상품', images: [] },
      'saleRoundItems/item-1': makeItem(),
      'saleRoundItems/item-foreign': makeItem({ id: 'item-foreign', storeId: 'store-2' }),
    });

    await (service as any).updateRound('store-1', 'round-1', 'seller-1', 'seller', {
      items: [{ productId: 'product-1', roundPrice: 12000, saleLimitQuantity: 2, displayOrder: 0 }],
    });

    expect(records.has('saleRoundItems/item-1')).toBe(false);
    expect(records.has('saleRoundItems/item-foreign')).toBe(true);
  });

  it('회차 상품 사용량이 transaction 안에서 확인되면 상품과 한도 변경을 함께 거부한다', async () => {
    const { service, records } = makeService({
      'products/product-1': { storeId: 'store-1', name: '공개 상품', images: [] },
      'saleRoundItems/item-1': makeItem({ reservedQuantity: 1 }),
    });

    await expect(
      (service as any).updateRound('store-1', 'round-1', 'seller-1', 'seller', {
        limits: { maxDeliveryAddresses: 10, maxItemQuantity: 10 },
        items: [
          { productId: 'product-1', roundPrice: 12000, saleLimitQuantity: 2, displayOrder: 0 },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(records.get('saleRoundItems/item-1')).toMatchObject({ reservedQuantity: 1 });
    expect(records.get('saleRounds/round-1')).toMatchObject({
      limits: { maxDeliveryAddresses: 15, maxItemQuantity: 30 },
    });
  });

  it('회차 수정은 transaction 진입 시점의 최신 상태가 편집 가능하지 않으면 거부한다', async () => {
    const { service, records, firestore } = makeService();
    const originalRunTransaction = firestore.runTransaction;
    firestore.runTransaction = jest.fn(async (callback) => {
      records.set('saleRounds/round-1', {
        ...records.get('saleRounds/round-1'),
        status: 'OPEN',
      });
      return originalRunTransaction(callback);
    });

    await expect(
      (service as any).updateRound('store-1', 'round-1', 'seller-1', 'seller', {
        name: '최신 상태에서 수정 시도',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(records.get('saleRounds/round-1')).toMatchObject({
      status: 'OPEN',
      name: '7월 3주차 호접란',
    });
  });

  it('seller copy는 source round의 foreign-store item을 제외한다', async () => {
    const { service } = makeService(
      {
        'products/product-1': { storeId: 'store-1', name: '공개 상품', images: [] },
        'saleRoundItems/item-1': makeItem(),
        'saleRoundItems/item-foreign': makeItem({ id: 'item-foreign', storeId: 'store-2' }),
      },
      makeRound({ status: 'OPEN' }),
    );

    const copied = await (service as any).copyRound('store-1', 'seller-1', 'seller', {
      name: '복사 회차',
      sourceRoundId: 'round-1',
      schedule: makeRound().schedule,
    });

    expect(copied.items).toHaveLength(1);
    expect(copied.items[0]).toMatchObject({ storeId: 'store-1', productId: 'product-1' });
  });

  it('주문 시작·마감·한도 도달 상태를 순서대로 자동 전환한다', async () => {
    const opened = makeService();
    await expect(opened.service.refreshRoundStatus('store-1', 'round-1')).resolves.toMatchObject({
      status: 'OPEN',
    });

    const closed = makeService(
      {},
      makeRound({
        status: 'OPEN',
        schedule: { ...makeRound().schedule, orderCloseAt: '2026-07-14T00:00:00.000+09:00' },
      }),
    );
    await expect(closed.service.refreshRoundStatus('store-1', 'round-1')).resolves.toMatchObject({
      status: 'CLOSED',
    });

    const full = makeService(
      {},
      makeRound({
        status: 'OPEN',
        counters: {
          ...makeRound().counters,
          reservedDeliveryAddresses: 2,
          orderedDeliveryAddresses: 13,
        },
      }),
    );
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

  it('상태 변경 transaction의 현재 상태가 목표 전이와 다르면 거부한다', async () => {
    const { service, records, firestore, writes } = makeService({}, makeRound({ status: 'OPEN' }));
    const originalRunTransaction = firestore.runTransaction;
    firestore.runTransaction = jest.fn(async (callback) => {
      records.set('saleRounds/round-1', {
        ...records.get('saleRounds/round-1'),
        status: 'SCHEDULED',
        closeReason: null,
      });
      return originalRunTransaction(callback);
    });

    await expect(
      (service as any).updateStatus('store-1', 'round-1', 'seller-1', 'seller', {
        status: 'CLOSED',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(writes.filter((write) => write.path === 'saleRounds/round-1')).toHaveLength(0);
  });

  it('주문 시작 전 수동 OPEN을 거부하고 시작 시각 이후에는 허용한다', async () => {
    const beforeOpen = makeService(
      {},
      makeRound({
        schedule: {
          ...makeRound().schedule,
          orderOpenAt: '2026-07-15T00:31:00.000+09:00',
        },
      }),
    );
    await expect(
      (beforeOpen.service as any).updateStatus('store-1', 'round-1', 'seller-1', 'seller', {
        status: 'OPEN',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const atOpen = makeService(
      {},
      makeRound({
        schedule: {
          ...makeRound().schedule,
          orderOpenAt: '2026-07-14T00:30:00.000+09:00',
        },
      }),
    );
    await expect(
      (atOpen.service as any).updateStatus('store-1', 'round-1', 'seller-1', 'seller', {
        status: 'OPEN',
      }),
    ).resolves.toMatchObject({ status: 'OPEN' });
  });

  it('용량 자동 마감은 원인을 기록하고 예약 반환 뒤 마감 전이면 다시 연다', async () => {
    const { service, records } = makeService(
      {},
      makeRound({
        status: 'OPEN',
        counters: { ...makeRound().counters, reservedDeliveryAddresses: 15 },
      }),
    );

    await expect(service.refreshRoundStatus('store-1', 'round-1')).resolves.toMatchObject({
      status: 'CLOSED',
      closeReason: 'CAPACITY',
    });
    records.set('saleRounds/round-1', {
      ...records.get('saleRounds/round-1'),
      counters: { ...makeRound().counters, reservedDeliveryAddresses: 14 },
    });
    await expect(service.refreshRoundStatus('store-1', 'round-1')).resolves.toMatchObject({
      status: 'OPEN',
      closeReason: null,
    });
  });

  it('일정·수동 마감 회차는 용량이 회복돼도 다시 열지 않는다', async () => {
    for (const closeReason of ['SCHEDULE_ENDED', 'MANUAL']) {
      const { service } = makeService(
        {},
        makeRound({
          status: 'CLOSED',
          closeReason: closeReason as SaleRound['closeReason'],
        }),
      );
      await expect(service.refreshRoundStatus('store-1', 'round-1')).resolves.toMatchObject({
        status: 'CLOSED',
        closeReason,
      });
    }
  });

  it('배송 보류 또는 미완료 주문이 남아 있으면 완료를 차단한다', async () => {
    const held = makeService(
      {},
      makeRound({
        status: 'CLOSED',
        counters: { ...makeRound().counters, heldOrderCount: 1 },
      }),
    );
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

  it('회차 취소는 모든 활성 주문 정리가 끝난 뒤에만 확정한다', async () => {
    const { service, roundLifecycle, records } = makeService(
      {
        'orders/order-1': { id: 'order-1', roundId: 'round-1', status: 'ACCEPTED' },
        'orders/order-2': { id: 'order-2', roundId: 'round-1', status: 'PENDING' },
      },
      makeRound({ status: 'OPEN' }),
    );
    await (service as any).updateStatus('store-1', 'round-1', 'seller-1', 'seller', {
      status: 'CANCELLED',
    });
    await (service as any).updateStatus('store-1', 'round-1', 'seller-1', 'seller', {
      status: 'CANCELLED',
    });

    expect(roundLifecycle.cancelForRound).toHaveBeenCalledTimes(2);
    expect(records.get('orders/order-1')).toMatchObject({ status: 'CANCELLED' });
    expect(records.get('orders/order-2')).toMatchObject({ status: 'CANCELLED' });
    expect(records.get('saleRounds/round-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: expect.objectContaining({ status: 'COMPLETED' }),
    });
  });

  it('회차 취소 정리 실패는 실패 주문을 기록하고 재시도 가능한 상태를 보존한다', async () => {
    const { service, roundLifecycle, records } = makeService(
      {
        'orders/order-1': { id: 'order-1', roundId: 'round-1', status: 'ACCEPTED' },
      },
      makeRound({ status: 'OPEN' }),
    );
    roundLifecycle.cancelForRound
      .mockRejectedValueOnce(new Error('예약 반환 실패'))
      .mockImplementationOnce(async ({ orderId }: { orderId: string }) => {
        records.set(`orders/${orderId}`, {
          ...records.get(`orders/${orderId}`),
          status: 'CANCELLED',
          cancellation: { status: 'COMPLETED' },
        });
      });
    await expect(
      (service as any).updateStatus('store-1', 'round-1', 'seller-1', 'seller', {
        status: 'CANCELLED',
      }),
    ).rejects.toThrow('예약 반환 실패');
    expect(records.get('saleRounds/round-1')).toMatchObject({
      status: 'OPEN',
      cancellation: expect.objectContaining({
        status: 'LOCAL_FAILED',
        failedOrderId: 'order-1',
      }),
    });

    await expect(
      (service as any).updateStatus('store-1', 'round-1', 'seller-1', 'seller', {
        status: 'CANCELLED',
      }),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(roundLifecycle.cancelForRound).toHaveBeenCalledTimes(2);
  });

  it('활성 취소 lease는 두 번째 owner를 막고 만료 뒤에는 takeover를 허용한다', async () => {
    const { service, records } = makeService({}, makeRound({ status: 'OPEN' }));
    const state = (service as any).roundState as SaleRoundStateService;
    const firstClaim = { ownerId: 'worker-a', leaseId: 'lease-a' };
    const secondClaim = { ownerId: 'worker-b', leaseId: 'lease-b' };
    const input = {
      storeId: 'store-1',
      roundId: 'round-1',
      expectedStatus: 'OPEN',
      reason: '취소 복구',
    };

    await (state as any).claimCancellation(input, firstClaim);
    await expect((state as any).claimCancellation(input, secondClaim)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(records.get('saleRounds/round-1')?.['cancellation']).toMatchObject({
      status: 'CANCELLING',
      ownerId: 'worker-a',
      leaseId: 'lease-a',
    });

    records.set('saleRounds/round-1', {
      ...records.get('saleRounds/round-1'),
      cancellation: {
        ...records.get('saleRounds/round-1')?.['cancellation'],
        leaseExpiresAt: '2026-07-14T00:29:00.000+09:00',
      },
    });
    await expect((state as any).claimCancellation(input, secondClaim)).resolves.toMatchObject({
      done: false,
      claim: expect.objectContaining(secondClaim),
    });
    expect(records.get('saleRounds/round-1')?.['cancellation']).toMatchObject({
      ownerId: 'worker-b',
      leaseId: 'lease-b',
    });
  });

  it('소유권을 잃은 worker의 실패 기록은 새 owner의 lease를 덮어쓰지 않는다', async () => {
    const { service, records } = makeService({}, makeRound({ status: 'OPEN' }));
    const state = (service as any).roundState as SaleRoundStateService;
    const firstClaim = { ownerId: 'worker-a', leaseId: 'lease-a' };
    const secondClaim = { ownerId: 'worker-b', leaseId: 'lease-b' };
    const input = {
      storeId: 'store-1',
      roundId: 'round-1',
      expectedStatus: 'OPEN',
      reason: '취소 복구',
    };

    await (state as any).claimCancellation(input, firstClaim);
    records.set('saleRounds/round-1', {
      ...records.get('saleRounds/round-1'),
      cancellation: {
        ...records.get('saleRounds/round-1')?.['cancellation'],
        leaseExpiresAt: '2026-07-14T00:29:00.000+09:00',
      },
    });
    await (state as any).claimCancellation(input, secondClaim);

    await expect(
      (state as any).recordCancellationFailure(
        'store-1',
        'round-1',
        '오래된 worker 실패',
        'order-1',
        firstClaim,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(records.get('saleRounds/round-1')?.['cancellation']).toMatchObject({
      status: 'CANCELLING',
      ownerId: 'worker-b',
      leaseId: 'lease-b',
    });
  });

  it('worker가 중단된 CANCELLING 회차는 lease 만료 뒤 재시도로 CANCELLED에 수렴한다', async () => {
    const { service, records, roundLifecycle } = makeService({}, makeRound({ status: 'OPEN' }));
    const state = (service as any).roundState as SaleRoundStateService;
    await (state as any).claimCancellation(
      {
        storeId: 'store-1',
        roundId: 'round-1',
        expectedStatus: 'OPEN',
        reason: '중단 복구',
      },
      { ownerId: 'crashed-worker', leaseId: 'crashed-lease' },
    );
    records.set('saleRounds/round-1', {
      ...records.get('saleRounds/round-1'),
      cancellation: {
        ...records.get('saleRounds/round-1')?.['cancellation'],
        leaseExpiresAt: '2026-07-14T00:29:00.000+09:00',
      },
    });

    await expect(
      state.cancel({
        storeId: 'store-1',
        roundId: 'round-1',
        reason: '중단 복구',
      }),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(roundLifecycle.cancelForRound).not.toHaveBeenCalled();
    expect(records.get('saleRounds/round-1')?.['cancellation']).toMatchObject({
      status: 'COMPLETED',
      ownerId: null,
      leaseId: null,
    });
  });

  it('Firestore Timestamp를 ISO8601로 정규화한 뒤 최신순으로 정렬한다', async () => {
    const { service } = makeService({
      'saleRounds/round-1': { ...makeRound(), createdAt: timestamp('2026-07-10T00:00:00.000Z') },
      'saleRounds/round-2': {
        ...makeRound({ id: 'round-2' }),
        createdAt: timestamp('2026-07-12T00:00:00.000Z'),
      },
    });

    await expect(
      (service as any).listSellerRounds('store-1', 'seller-1', 'seller'),
    ).resolves.toMatchObject({
      items: [
        { id: 'round-2', createdAt: '2026-07-12T00:00:00.000Z' },
        { id: 'round-1', createdAt: '2026-07-10T00:00:00.000Z' },
      ],
    });
  });
});
