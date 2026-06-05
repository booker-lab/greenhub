import type { OrderStatus } from '@greenhub/shared';
import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';

const ORDER_STATUSES: OrderStatus[] = [
  'PENDING',
  'RECRUITING',
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'DELIVERING',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'CANCELLED',
  'REVIEWED',
];

const RISK_STATUSES: OrderStatus[] = [
  'DELIVERING',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'REVIEWED',
];

function createRefundService(status: OrderStatus) {
  const update = jest.fn().mockResolvedValue(undefined);
  const processRefundByOrderId = jest.fn().mockResolvedValue(undefined);
  const firestore = {
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ id: 'order-1', status }),
      }),
      update,
    }),
    Timestamp: {
      now: jest.fn(() => 'now'),
    },
  };

  const service = new AdminService(firestore as never, { processRefundByOrderId } as never);
  return { service, update, processRefundByOrderId };
}

function createOrderDocs(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    data: () => ({
      id: `order-${index + 1}`,
      createdAt: { toDate: () => new Date(Date.UTC(2026, 4, 29, 3, index)) },
    }),
  }));
}

function createOrdersService(count = 2) {
  const docs = createOrderDocs(count);
  const query = {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    startAfter: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs }),
  };
  const firestore = {
    collection: jest.fn().mockReturnValue(query),
    Timestamp: {
      fromDate: jest.fn((date: Date) => date),
    },
  };
  const service = new AdminService(firestore as never, {} as never);
  return { service, query, firestore };
}

function createSettlementDocs(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    data: () => ({
      id: `settlement-${index + 1}`,
      settledAt: { toDate: () => new Date(Date.UTC(2026, 4, 29, 3, index)) },
    }),
  }));
}

function createSettlementsService(count = 2) {
  const docs = createSettlementDocs(count);
  const query = {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    startAfter: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs }),
  };
  const firestore = {
    collection: jest.fn().mockReturnValue(query),
    Timestamp: {
      fromDate: jest.fn((date: Date) => date),
    },
  };
  const service = new AdminService(firestore as never, {} as never);
  return { service, query, firestore };
}

function createStoreSummaryService() {
  const storeDoc = {
    exists: true,
    data: () => ({
      id: 'store-1',
      name: '디어 플라워',
      ownerId: 'owner-1',
      status: 'active',
      commissionRate: 0.05,
    }),
  };
  const ownerDoc = {
    exists: true,
    data: () => ({
      id: 'owner-1',
      name: '정연',
      email: 'owner@example.com',
      phone: '010-1234-5678',
    }),
  };
  const orderDocs = [
    { data: () => ({ id: 'order-1', status: 'CONFIRMED', totalAmount: 10000 }) },
    { data: () => ({ id: 'order-2', status: 'DELIVERED', totalAmount: 20000 }) },
    { data: () => ({ id: 'order-3', status: 'DELIVERED', totalAmount: 30000 }) },
  ];
  const settlementDocs = [
    { data: () => ({ id: 'settle-1', status: 'confirmed', platformFee: 500, netAmount: 9500 }) },
    { data: () => ({ id: 'settle-2', status: 'paid', platformFee: 1000, netAmount: 19000 }) },
  ];
  const orderQuery = {
    where: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: orderDocs, size: orderDocs.length }),
  };
  const settlementQuery = {
    where: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: settlementDocs, size: settlementDocs.length }),
  };
  const firestore = {
    doc: jest.fn((path: string) => {
      if (path === 'stores/store-1') return { get: jest.fn().mockResolvedValue(storeDoc) };
      if (path === 'users/owner-1') return { get: jest.fn().mockResolvedValue(ownerDoc) };
      return { get: jest.fn().mockResolvedValue({ exists: false }) };
    }),
    collection: jest.fn((name: string) => {
      if (name === 'orders') return orderQuery;
      if (name === 'settlements') return settlementQuery;
      throw new Error(`예상하지 않은 컬렉션: ${name}`);
    }),
  };
  const service = new AdminService(firestore as never, {} as never);
  return { service, firestore, orderQuery, settlementQuery };
}

function createPlatformConfigService(config: Record<string, unknown> | null) {
  const set = jest.fn().mockResolvedValue(undefined);
  const firestore = {
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: config !== null,
        data: () => config,
      }),
      set,
    }),
    Timestamp: {
      now: jest.fn(() => 'now'),
    },
  };
  const service = new AdminService(firestore as never, {} as never);
  return { service, set };
}

describe('AdminService.bulkMarkAsPaid', () => {
  const createService = () =>
    new AdminService({} as never, {} as never) as AdminService & {
      markAsPaid: jest.Mock;
    };

  it('중복 ID를 제거하고 성공 ID를 반환한다', async () => {
    const service = createService();
    service.markAsPaid = jest.fn().mockResolvedValue({ status: 'paid' });

    await expect(service.bulkMarkAsPaid(['settle-1', 'settle-1', 'settle-2'])).resolves.toEqual({
      ok: ['settle-1', 'settle-2'],
      failed: [],
    });
    expect(service.markAsPaid).toHaveBeenCalledTimes(2);
  });

  it('일부 실패가 있어도 나머지 지급을 계속 처리한다', async () => {
    const service = createService();
    service.markAsPaid = jest
      .fn()
      .mockResolvedValueOnce({ status: 'paid' })
      .mockRejectedValueOnce(new BadRequestException('이미 지급 완료된 정산입니다.'))
      .mockResolvedValueOnce({ status: 'paid' });

    await expect(service.bulkMarkAsPaid(['settle-1', 'settle-2', 'settle-3'])).resolves.toEqual({
      ok: ['settle-1', 'settle-3'],
      failed: [{ id: 'settle-2', reason: '이미 지급 완료된 정산입니다.' }],
    });
  });

  it('전체 실패도 실패 목록으로 반환한다', async () => {
    const service = createService();
    service.markAsPaid = jest
      .fn()
      .mockRejectedValue(
        new BadRequestException('confirmed 상태의 정산만 지급 처리할 수 있습니다.'),
      );

    await expect(service.bulkMarkAsPaid(['settle-1', 'settle-2'])).resolves.toEqual({
      ok: [],
      failed: [
        { id: 'settle-1', reason: 'confirmed 상태의 정산만 지급 처리할 수 있습니다.' },
        { id: 'settle-2', reason: 'confirmed 상태의 정산만 지급 처리할 수 있습니다.' },
      ],
    });
  });
});

describe('AdminService.getOrders', () => {
  it('기본 최신순 50건 조회와 다음 커서를 반환한다', async () => {
    const { service, query } = createOrdersService(51);

    const result = await service.getOrders({});

    expect(result.orders).toHaveLength(50);
    expect(result.total).toBe(50);
    expect(result.nextCursor).toBe('2026-05-29T03:49:00.000Z');
    expect(query.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(query.limit).toHaveBeenCalledWith(51);
  });

  it('필터·오래된순·limit·cursor를 쿼리에 적용한다', async () => {
    const { service, query, firestore } = createOrdersService();

    await service.getOrders({
      storeId: 'store-1',
      status: 'PREPARING',
      sort: 'createdAt_asc',
      limit: 1,
      cursor: '2026-05-29T01:00:00.000Z',
    });

    expect(query.where).toHaveBeenCalledWith('storeId', '==', 'store-1');
    expect(query.where).toHaveBeenCalledWith('status', '==', 'PREPARING');
    expect(query.orderBy).toHaveBeenCalledWith('createdAt', 'asc');
    expect(firestore.Timestamp.fromDate).toHaveBeenCalledWith(new Date('2026-05-29T01:00:00.000Z'));
    expect(query.startAfter).toHaveBeenCalledWith(new Date('2026-05-29T01:00:00.000Z'));
    expect(query.limit).toHaveBeenCalledWith(2);
  });
});

describe('AdminService.getSettlements', () => {
  it('기본 100건 조회와 다음 커서를 반환한다', async () => {
    const { service, query } = createSettlementsService(101);

    const result = await service.getSettlements({});

    expect(result.settlements).toHaveLength(100);
    expect(result.total).toBe(100);
    expect(result.nextCursor).toBe('2026-05-29T04:39:00.000Z');
    expect(query.orderBy).toHaveBeenCalledWith('settledAt', 'desc');
    expect(query.limit).toHaveBeenCalledWith(101);
  });

  it('필터·limit·cursor를 쿼리에 적용한다', async () => {
    const { service, query, firestore } = createSettlementsService();

    await service.getSettlements({
      storeId: 'store-1',
      status: 'confirmed',
      from: '2026-05-01',
      to: '2026-05-31',
      limit: 1,
      cursor: '2026-05-29T01:00:00.000Z',
    });

    expect(query.where).toHaveBeenCalledWith('storeId', '==', 'store-1');
    expect(query.where).toHaveBeenCalledWith('status', '==', 'confirmed');
    expect(query.where).toHaveBeenCalledWith('settledAt', '>=', new Date('2026-05-01'));
    expect(query.where).toHaveBeenCalledWith('settledAt', '<=', expect.any(Date));
    expect(firestore.Timestamp.fromDate).toHaveBeenCalledWith(new Date('2026-05-29T01:00:00.000Z'));
    expect(query.startAfter).toHaveBeenCalledWith(new Date('2026-05-29T01:00:00.000Z'));
    expect(query.limit).toHaveBeenCalledWith(2);
  });
});

describe('AdminService.getStoreSummary', () => {
  it('스토어, owner, 주문·정산 집계를 반환한다', async () => {
    const { service, orderQuery, settlementQuery } = createStoreSummaryService();

    await expect(service.getStoreSummary('store-1')).resolves.toEqual({
      store: expect.objectContaining({
        id: 'store-1',
        name: '디어 플라워',
        ownerId: 'owner-1',
      }),
      owner: {
        id: 'owner-1',
        name: '정연',
        email: 'owner@example.com',
        phone: '010-1234-5678',
      },
      orders: {
        totalCount: 3,
        totalAmount: 60000,
        byStatus: { CONFIRMED: 1, DELIVERED: 2 },
      },
      settlements: {
        totalCount: 2,
        platformFee: 1500,
        netAmount: 28500,
        byStatus: { confirmed: 1, paid: 1 },
      },
    });
    expect(orderQuery.where).toHaveBeenCalledWith('storeId', '==', 'store-1');
    expect(settlementQuery.where).toHaveBeenCalledWith('storeId', '==', 'store-1');
  });

  it('스토어가 없으면 404를 반환한다', async () => {
    const { service } = createStoreSummaryService();

    await expect(service.getStoreSummary('missing-store')).rejects.toThrow(
      '스토어를 찾을 수 없습니다.',
    );
  });
});

describe('AdminService 플랫폼 설정', () => {
  it('설정 문서가 없으면 기본 수수료율 0을 반환한다', async () => {
    const { service } = createPlatformConfigService(null);

    await expect(service.getPlatformConfig()).resolves.toEqual({ defaultCommissionRate: 0 });
  });

  it('기본 수수료율을 저장한다', async () => {
    const { service, set } = createPlatformConfigService({ defaultCommissionRate: 0.03 });

    await expect(service.setDefaultCommission({ rate: 0.05 })).resolves.toEqual({
      defaultCommissionRate: 0.05,
    });
    expect(set).toHaveBeenCalledWith(
      { defaultCommissionRate: 0.05, updatedAt: 'now' },
      { merge: true },
    );
  });
});

describe('AdminService.forceRefund', () => {
  const reasons = [
    { label: '사유 없음', value: undefined },
    { label: '짧은 사유', value: '짧음' },
    { label: '정상 사유', value: '고객요청환불' },
  ];

  for (const status of ORDER_STATUSES) {
    for (const reason of reasons) {
      const shouldRejectCancelled = status === 'CANCELLED';
      const shouldRejectRiskReason =
        RISK_STATUSES.includes(status) && (!reason.value || reason.value.trim().length < 5);

      it(`${status} 상태와 ${reason.label} 조합을 정책대로 처리한다`, async () => {
        const { service, processRefundByOrderId, update } = createRefundService(status);
        const action = service.forceRefund('order-1', { reason: reason.value });

        if (shouldRejectCancelled) {
          await expect(action).rejects.toThrow('이미 취소된 주문입니다.');
          expect(processRefundByOrderId).not.toHaveBeenCalled();
          expect(update).not.toHaveBeenCalled();
          return;
        }

        if (shouldRejectRiskReason) {
          await expect(action).rejects.toThrow('배달 후 환불은 사유(5자 이상)가 필수입니다.');
          expect(processRefundByOrderId).not.toHaveBeenCalled();
          expect(update).not.toHaveBeenCalled();
          return;
        }

        await expect(action).resolves.toEqual({ ok: true, orderId: 'order-1' });
        expect(processRefundByOrderId).toHaveBeenCalledWith(
          'order-1',
          reason.value?.trim() || '관리자 강제 환불',
        );
        expect(update).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'CANCELLED',
            cancelReason: reason.value?.trim() || '관리자 강제 환불',
          }),
        );
      });
    }
  }
});
