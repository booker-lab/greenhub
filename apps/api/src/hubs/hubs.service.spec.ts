import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { HUB_ORDER_LIST_LIMIT, HubsService } from './hubs.service';

type DocData = Record<string, unknown> | null;

interface QueryCall {
  collection: string;
  wheres: [string, string, unknown][];
  orderBy: [string, string | undefined][];
  limit?: number;
}

function makeFirestore(options: {
  docs?: Record<string, DocData>;
  queryResults?: Record<string, Record<string, unknown>[]>;
}) {
  const docs = options.docs ?? {};
  const queries: QueryCall[] = [];
  const docRefs: Record<
    string,
    { get: jest.Mock; set: jest.Mock; update: jest.Mock; delete: jest.Mock }
  > = {};

  const doc = jest.fn((path: string) => {
    if (!docRefs[path]) {
      const data = docs[path] ?? null;
      docRefs[path] = {
        get: jest.fn().mockResolvedValue({ exists: data !== null, data: () => data }),
        set: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
      };
    }
    return docRefs[path];
  });

  const collection = jest.fn((name: string) => {
    const call: QueryCall = { collection: name, wheres: [], orderBy: [] };
    queries.push(call);
    const query: Record<string, jest.Mock> = {};
    query.where = jest.fn((field: string, op: string, value: unknown) => {
      call.wheres.push([field, op, value]);
      return query;
    });
    query.orderBy = jest.fn((field: string, dir?: string) => {
      call.orderBy.push([field, dir]);
      return query;
    });
    query.limit = jest.fn((n: number) => {
      call.limit = n;
      return query;
    });
    query.get = jest.fn(async () => {
      const rows = options.queryResults?.[name] ?? [];
      const limited = call.limit === undefined ? rows : rows.slice(0, call.limit);
      return {
        docs: limited.map((row) => ({ id: String(row['id']), data: () => row })),
      };
    });
    return query;
  });

  const firestore = {
    doc,
    collection,
    Timestamp: { now: jest.fn(() => 'NOW') },
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TS') },
  };

  return { firestore, queries, docRefs };
}

const OWNED_STORE = { 'stores/store-1': { id: 'store-1', ownerId: 'seller-1' } };
const HUB = { 'hubs/hub-1': { id: 'hub-1', storeId: 'store-1', name: '강남 거점' } };

function rawHubOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    storeId: 'store-1',
    orderNumber: 'GH-0001',
    productId: 'product-1',
    productName: '호접란',
    quantity: 1,
    saleType: 'regular',
    status: 'HUB_ARRIVED',
    deliveryMethod: 'hub',
    deliveryFee: 0,
    totalAmount: 30000,
    pickupCode: '123456',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    buyerName: '김손님',
    userId: 'consumer-1',
    buyerPhone: '010-1111-2222',
    sellerPhone: '010-3333-4444',
    deliveryPhone: '010-5555-6666',
    address: '서울시 강남구 1',
    deliveryAddress: { address: '서울시 강남구 1', addressDetail: '101호', zipCode: '06000' },
    requestNote: '문 앞',
    hubId: 'hub-1',
    hubName: '강남 거점',
    hubAddress: '서울시 강남구 2',
    driverId: 'driver-1',
    photoUrl: 'https://example.com/photo.jpg',
    ...overrides,
  };
}

describe('HubsService 거점 주문 목록', () => {
  it('hubId와 storeId를 함께 걸고 상한을 둔 쿼리로 조회한다', async () => {
    const { firestore, queries } = makeFirestore({ docs: { ...OWNED_STORE, ...HUB } });
    const service = new HubsService(firestore as never);

    await service.getHubOrders('store-1', 'hub-1', 'seller-1', 'HUB_ARRIVED');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toEqual({
      collection: 'orders',
      wheres: [
        ['hubId', '==', 'hub-1'],
        ['storeId', '==', 'store-1'],
        ['status', '==', 'HUB_ARRIVED'],
      ],
      // 복합 인덱스가 없는 조합이므로 orderBy를 쿼리에 싣지 않는다.
      orderBy: [],
      limit: HUB_ORDER_LIST_LIMIT + 1,
    });
  });

  it('status가 없으면 상태 조건 없이 조회한다', async () => {
    const { firestore, queries } = makeFirestore({ docs: { ...OWNED_STORE, ...HUB } });
    const service = new HubsService(firestore as never);

    await service.getHubOrders('store-1', 'hub-1', 'seller-1');

    expect(queries[0].wheres).toEqual([
      ['hubId', '==', 'hub-1'],
      ['storeId', '==', 'store-1'],
    ]);
  });

  it('판매자 주문 목록과 같은 필드만 돌려주고 연락처·주소·기사 정보는 뺀다', async () => {
    const { firestore } = makeFirestore({
      docs: { ...OWNED_STORE, ...HUB },
      queryResults: { orders: [rawHubOrder()] },
    });
    const service = new HubsService(firestore as never);

    const result = await service.getHubOrders('store-1', 'hub-1', 'seller-1', 'HUB_ARRIVED');

    expect(result.hasMore).toBe(false);
    expect(result.orders).toEqual([
      {
        id: 'order-1',
        storeId: 'store-1',
        orderNumber: 'GH-0001',
        productId: 'product-1',
        productName: '호접란',
        quantity: 1,
        saleType: 'regular',
        status: 'HUB_ARRIVED',
        deliveryMethod: 'hub',
        deliveryFee: 0,
        totalAmount: 30000,
        pickupCode: '123456',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        buyerName: '김손님',
      },
    ]);
    const [order] = result.orders as Record<string, unknown>[];
    for (const hidden of [
      'userId',
      'buyerPhone',
      'sellerPhone',
      'deliveryPhone',
      'address',
      'deliveryAddress',
      'requestNote',
      'hubName',
      'hubAddress',
      'driverId',
      'photoUrl',
    ]) {
      expect(order).not.toHaveProperty(hidden);
    }
  });

  it('최신 주문이 먼저 오도록 정렬한다', async () => {
    const { firestore } = makeFirestore({
      docs: { ...OWNED_STORE, ...HUB },
      queryResults: {
        orders: [
          rawHubOrder({ id: 'old', createdAt: { seconds: 100, nanoseconds: 0 } }),
          rawHubOrder({ id: 'new', createdAt: { toMillis: () => 300_000 } }),
          rawHubOrder({ id: 'mid', createdAt: '1970-01-01T00:03:20.000Z' }),
          rawHubOrder({ id: 'none', createdAt: undefined }),
        ],
      },
    });
    const service = new HubsService(firestore as never);

    const result = await service.getHubOrders('store-1', 'hub-1', 'seller-1');

    expect((result.orders as Record<string, unknown>[]).map((o) => o['id'])).toEqual([
      'new',
      'mid',
      'old',
      'none',
    ]);
  });

  it('상한을 넘으면 상한만큼만 돌려주고 hasMore를 켠다', async () => {
    const rows = Array.from({ length: HUB_ORDER_LIST_LIMIT + 5 }, (_, i) =>
      rawHubOrder({ id: `order-${i}` }),
    );
    const { firestore } = makeFirestore({
      docs: { ...OWNED_STORE, ...HUB },
      queryResults: { orders: rows },
    });
    const service = new HubsService(firestore as never);

    const result = await service.getHubOrders('store-1', 'hub-1', 'seller-1');

    expect(result.orders).toHaveLength(HUB_ORDER_LIST_LIMIT);
    expect(result.hasMore).toBe(true);
  });

  it('다른 매장 소유자는 403을 받고 주문을 조회하지 않는다', async () => {
    const { firestore, queries } = makeFirestore({ docs: { ...OWNED_STORE, ...HUB } });
    const service = new HubsService(firestore as never);

    await expect(service.getHubOrders('store-1', 'hub-1', 'seller-2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(queries).toHaveLength(0);
  });

  it('다른 매장의 거점이면 404를 주고 주문을 조회하지 않는다', async () => {
    const { firestore, queries } = makeFirestore({
      docs: {
        ...OWNED_STORE,
        'hubs/hub-9': { id: 'hub-9', storeId: 'store-2' },
      },
    });
    const service = new HubsService(firestore as never);

    await expect(service.getHubOrders('store-1', 'hub-9', 'seller-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(queries).toHaveLength(0);
  });

  it.each([
    [['HUB_ARRIVED', 'PENDING']],
    [''],
    [{ a: 1 }],
  ])('status가 문자열이 아니거나 비어 있으면(%p) 400을 준다', async (status) => {
    const { firestore, queries } = makeFirestore({ docs: { ...OWNED_STORE, ...HUB } });
    const service = new HubsService(firestore as never);

    await expect(
      service.getHubOrders('store-1', 'hub-1', 'seller-1', status),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queries).toHaveLength(0);
  });
});

describe('HubsService 거점 CRUD 소유권', () => {
  it('목록은 소유 매장의 거점만 생성순으로 조회한다', async () => {
    const { firestore, queries } = makeFirestore({
      docs: OWNED_STORE,
      queryResults: { hubs: [{ id: 'hub-1', storeId: 'store-1' }] },
    });
    const service = new HubsService(firestore as never);

    await expect(service.getHubs('store-1', 'seller-1')).resolves.toEqual({
      hubs: [{ id: 'hub-1', storeId: 'store-1' }],
    });
    expect(queries[0]).toMatchObject({
      collection: 'hubs',
      wheres: [['storeId', '==', 'store-1']],
      orderBy: [['createdAt', 'asc']],
    });
  });

  it('없는 매장이나 소유자가 아니면 모든 경로가 403이다', async () => {
    const { firestore } = makeFirestore({ docs: { ...OWNED_STORE, ...HUB } });
    const service = new HubsService(firestore as never);

    await expect(service.getHubs('store-x', 'seller-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getHub('store-1', 'hub-1', 'seller-2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.createHub('store-1', 'seller-2', { name: 'n', address: 'a' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.updateHub('store-1', 'hub-1', 'seller-2', { name: 'n' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.deleteHub('store-1', 'hub-1', 'seller-2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('다른 매장의 거점은 조회·수정·삭제가 404이고 쓰지 않는다', async () => {
    const { firestore, docRefs } = makeFirestore({
      docs: { ...OWNED_STORE, 'hubs/hub-9': { id: 'hub-9', storeId: 'store-2' } },
    });
    const service = new HubsService(firestore as never);

    await expect(service.getHub('store-1', 'hub-9', 'seller-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.updateHub('store-1', 'hub-9', 'seller-1', { name: 'n' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteHub('store-1', 'hub-9', 'seller-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(docRefs['hubs/hub-9'].update).not.toHaveBeenCalled();
    expect(docRefs['hubs/hub-9'].delete).not.toHaveBeenCalled();
  });

  it('생성은 요청 매장 id로 거점을 저장한다', async () => {
    const { firestore, docRefs } = makeFirestore({ docs: OWNED_STORE });
    const service = new HubsService(firestore as never);

    const { id } = await service.createHub('store-1', 'seller-1', {
      name: '강남 거점',
      address: '서울시 강남구',
    });

    expect(docRefs[`hubs/${id}`].set).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        storeId: 'store-1',
        name: '강남 거점',
        address: '서울시 강남구',
        addressDetail: null,
        isActive: true,
      }),
    );
  });

  it('수정은 전달된 필드만 바꾸고 storeId는 바꾸지 않는다', async () => {
    const { firestore, docRefs } = makeFirestore({ docs: { ...OWNED_STORE, ...HUB } });
    const service = new HubsService(firestore as never);

    await service.updateHub('store-1', 'hub-1', 'seller-1', { name: '새 이름', isActive: false });

    expect(docRefs['hubs/hub-1'].update).toHaveBeenCalledWith({
      updatedAt: 'SERVER_TS',
      name: '새 이름',
      isActive: false,
    });
  });

  it('삭제는 소유 매장의 거점 문서를 지운다', async () => {
    const { firestore, docRefs } = makeFirestore({ docs: { ...OWNED_STORE, ...HUB } });
    const service = new HubsService(firestore as never);

    await service.deleteHub('store-1', 'hub-1', 'seller-1');

    expect(docRefs['hubs/hub-1'].delete).toHaveBeenCalled();
  });
});
