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
