import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { resolveAdminListLimit, summarizeOrderProducts, toAdminOrderRow } from './admin-lists';

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({ revokeRefreshTokens: jest.fn().mockResolvedValue(undefined) })),
}));

type Row = Record<string, any>;

// 관리자 목록 조회용 메모리 Firestore: where(==)·orderBy·startAfter(문서)·limit만 흉내 낸다.
function makeListFirestore(collections: Record<string, Row[]>) {
  const docReads: string[] = [];
  type Order = { field: string; direction: 'asc' | 'desc' };
  const query = (
    name: string,
    filters: Array<{ field: string; value: unknown }> = [],
    order?: Order,
    afterId?: string,
    max?: number,
  ): any => ({
    where: (field: string, _op: string, value: unknown) =>
      query(name, [...filters, { field, value }], order, afterId, max),
    orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') =>
      query(name, filters, { field, direction }, afterId, max),
    startAfter: (snap: { id: string }) => query(name, filters, order, snap.id, max),
    limit: (value: number) => query(name, filters, order, afterId, value),
    get: async () => {
      let rows = (collections[name] ?? []).filter((row) =>
        filters.every(({ field, value }) => row[field] === value),
      );
      if (order) {
        rows = [...rows].sort((a, b) =>
          order.direction === 'desc'
            ? b[order.field] - a[order.field]
            : a[order.field] - b[order.field],
        );
      }
      if (afterId !== undefined) rows = rows.slice(rows.findIndex((r) => r.id === afterId) + 1);
      if (max !== undefined) rows = rows.slice(0, max);
      const docs = rows.map((row) => ({ id: row.id, data: () => ({ ...row }) }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  const firestore = {
    collection: (name: string) => query(name),
    doc: (path: string) => ({
      get: async () => {
        docReads.push(path);
        const [name, id] = path.split('/');
        const row = (collections[name] ?? []).find((r) => r.id === id);
        return { exists: row !== undefined, id, data: () => (row ? { ...row } : undefined) };
      },
    }),
  };
  return { firestore, docReads };
}

function makeService(firestore: unknown) {
  return new AdminService(
    firestore as never,
    {} as never,
    {} as never,
    {} as never,
    { logAdmin: jest.fn().mockResolvedValue(undefined), listAdmin: jest.fn() } as never,
  );
}

describe('관리자 목록 순수 함수', () => {
  it('상품 요약은 첫 상품명 + 외 N개, 일반 주문은 상품명 하나다', () => {
    expect(
      summarizeOrderProducts({
        orderItems: [{ productName: '호접란' }, { productName: '동양란' }, { productName: '' }],
      }),
    ).toBe('호접란 외 1개');
    expect(summarizeOrderProducts({ orderItems: [{ productName: '호접란' }] })).toBe('호접란');
    expect(summarizeOrderProducts({ productName: ' 꽃다발 ' })).toBe('꽃다발');
    expect(summarizeOrderProducts({})).toBeNull();
  });

  it('주문 한 줄에는 고객 이름만 싣고 전화·주소·배송지는 싣지 않는다', () => {
    const row = toAdminOrderRow(
      {
        id: 'o-1',
        storeId: 's-1',
        status: 'CANCELLED',
        totalAmount: 30000,
        buyerName: '김손님',
        buyerPhone: '010-1111-2222',
        sellerPhone: '010-3333-4444',
        address: '서울시 어딘가',
        deliveryAddress: { address: '서울시 어딘가' },
        gift: { recipientName: '받는 분' },
        cancellation: { status: 'REFUND_FAILED', reason: '사유' },
      },
      new Map([['s-1', '난플렉스']]),
    );
    expect(row).toMatchObject({
      id: 'o-1',
      storeName: '난플렉스',
      buyerName: '김손님',
      cancellationStatus: 'REFUND_FAILED',
    });
    for (const hidden of ['buyerPhone', 'sellerPhone', 'address', 'deliveryAddress', 'gift']) {
      expect(row).not.toHaveProperty(hidden);
    }
  });

  it.each([
    [undefined, 50],
    ['abc', 50],
    ['0', 1],
    [20, 20],
    [1000, 100],
  ])('건수 %p → %p', (raw, expected) => {
    expect(resolveAdminListLimit(raw, 50, 100)).toBe(expected);
  });
});

describe('AdminService 판매자 목록', () => {
  it('허용 필드만 돌려준다(소유자 id·정산 계좌·사업자번호 등 제외)', async () => {
    const { firestore } = makeListFirestore({
      stores: [
        {
          id: 's-1',
          name: '난플렉스',
          status: 'archived',
          commissionRate: 0.1,
          ceoName: '대표',
          phone: '010-1234-5678',
          createdAt: 1,
          archivedAt: 2,
          ownerId: 'owner-1',
          businessNumber: '123-45-67890',
          bankAccount: { number: '000' },
          address: '경기도 이천',
        },
      ],
    });

    const result = await makeService(firestore).getStores();

    expect(result).toEqual({
      stores: [
        {
          id: 's-1',
          name: '난플렉스',
          status: 'archived',
          commissionRate: 0.1,
          ceoName: '대표',
          phone: '010-1234-5678',
          createdAt: 1,
          archivedAt: 2,
        },
      ],
      total: 1,
    });
  });
});

describe('AdminService 주문 목록 이어받기', () => {
  function seedOrders(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `o-${String(i).padStart(3, '0')}`,
      storeId: i % 2 === 0 ? 's-1' : 's-2',
      status: i % 3 === 0 ? 'CANCELLED' : 'ACCEPTED',
      totalAmount: 1000 * (i + 1),
      createdAt: i,
      productName: `상품${i}`,
      buyerName: `손님${i}`,
      buyerPhone: '010-0000-0000',
    }));
  }

  it('최신순으로 한 쪽씩 주고, nextCursor로 겹치거나 빠지지 않게 이어 받는다', async () => {
    const { firestore, docReads } = makeListFirestore({
      orders: seedOrders(5),
      stores: [
        { id: 's-1', name: '첫 가게' },
        { id: 's-2', name: '둘째 가게' },
      ],
    });
    const service = makeService(firestore);

    const first = await service.getOrders({ limit: 2 });
    expect(first.orders.map((o) => o['id'])).toEqual(['o-004', 'o-003']);
    expect(first).toMatchObject({ total: 2, hasMore: true, nextCursor: 'o-003' });
    expect(first.orders[0]).toMatchObject({ storeName: '첫 가게', buyerName: '손님4' });
    expect(first.orders[0]).not.toHaveProperty('buyerPhone');
    // 한 쪽에 나온 가게만, 가게마다 한 번씩 읽는다.
    expect(docReads.filter((p) => p.startsWith('stores/')).sort()).toEqual([
      'stores/s-1',
      'stores/s-2',
    ]);

    const second = await service.getOrders({ limit: 2, cursor: first.nextCursor } as never);
    expect(second.orders.map((o) => o['id'])).toEqual(['o-002', 'o-001']);

    const last = await service.getOrders({ limit: 2, cursor: second.nextCursor } as never);
    expect(last.orders.map((o) => o['id'])).toEqual(['o-000']);
    expect(last).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('가게·상태 필터를 그대로 적용한다', async () => {
    const { firestore } = makeListFirestore({ orders: seedOrders(7), stores: [] });

    const result = await makeService(firestore).getOrders({
      storeId: 's-1',
      status: 'CANCELLED',
    } as never);

    expect(result.orders.map((o) => o['id'])).toEqual(['o-006', 'o-000']);
    expect(result.orders[0]).toMatchObject({ storeName: null });
  });

  it.each(['../stores/s-1', 'missing-order'])('잘못된 cursor(%p)는 400으로 거절한다', async (cursor) => {
    const { firestore } = makeListFirestore({ orders: seedOrders(2), stores: [] });

    await expect(makeService(firestore).getOrders({ cursor })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('AdminService 기사 목록 이어받기', () => {
  function seedUsers(count: number) {
    const drivers = Array.from({ length: count }, (_, i) => ({
      id: `d-${String(i).padStart(3, '0')}`,
      role: 'driver',
      name: `기사${i}`,
      phone: `010-0000-${String(i).padStart(4, '0')}`,
      driverApproved: i % 2 === 1,
      suspended: false,
      createdAt: i,
      passwordHash: 'hash',
      fcmToken: 'token',
    }));
    return [...drivers, { id: 'c-1', role: 'consumer', createdAt: 999 }];
  }

  it('가입 최신순 한 쪽과 hasMore·nextCursor를 주고, 전화·가입일을 싣는다', async () => {
    const { firestore } = makeListFirestore({ users: seedUsers(3) });
    const service = makeService(firestore);

    const first = await service.getDrivers({ limit: 2 });
    expect(first.drivers).toEqual([
      {
        id: 'd-002',
        name: '기사2',
        phone: '010-0000-0002',
        driverApproved: false,
        suspended: false,
        createdAt: 2,
      },
      expect.objectContaining({ id: 'd-001' }),
    ]);
    expect(first).toMatchObject({ hasMore: true, nextCursor: 'd-001' });

    const next = await service.getDrivers({ limit: 2, cursor: first.nextCursor } as never);
    expect(next.drivers.map((d) => d['id'])).toEqual(['d-000']);
    expect(next).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('상태 필터는 읽은 쪽 안에서 거르고, 더 있으면 hasMore를 그대로 알린다', async () => {
    const { firestore } = makeListFirestore({ users: seedUsers(5) });

    const result = await makeService(firestore).getDrivers({
      status: 'approved',
      limit: 3,
    } as never);

    expect(result.drivers.map((d) => d['id'])).toEqual(['d-003']);
    expect(result).toMatchObject({ total: 1, hasMore: true, nextCursor: 'd-002' });
  });

  it('기사가 아닌 계정 id를 cursor로 주면 400으로 거절한다', async () => {
    const { firestore } = makeListFirestore({ users: seedUsers(2) });

    await expect(
      makeService(firestore).getDrivers({ cursor: 'c-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
