import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { OrderCapacityService } from '../orders/order-capacity.service';
import { RoundOrderLifecycleService } from '../orders/round-order-lifecycle.service';
import { PaymentFinalizationService } from '../payments/payment-finalization.service';
import { REFUND_NOTICE_REASONS } from './refund-notice-reasons';

type Data = Record<string, any>;

// 고객이 요청하지 않은 환불(회차 취소·관리자 환불·늦은 결제 자동 환불)도 고객에게 이유를 알린다.

function makeLifecycle(order: Data | null) {
  const firestore = {
    doc: jest.fn(() => ({
      get: jest.fn(async () => ({ exists: order !== null, data: () => order })),
    })),
  };
  const notifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
  const service = new RoundOrderLifecycleService(
    firestore as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    notifications as never,
  );
  const cancel = jest
    .spyOn(service as any, 'cancel')
    .mockResolvedValue({ orderId: 'order-1', status: 'CANCELLED' });
  return { service, notifications, cancel };
}

const baseInput = {
  storeId: 'store-1',
  orderId: 'order-1',
  expectedStatus: 'ACCEPTED' as const,
  reason: '관리자 사유',
};

describe('회차 주문 취소 환불 안내', () => {
  it('안내 본문에는 고객이 보는 주문번호를 쓰고 발송 기록·멱등 키는 문서 ID로 둔다', async () => {
    const { service, notifications } = makeLifecycle({
      userId: 'user-1',
      status: 'ACCEPTED',
      orderNumber: '20261101-000003',
    });

    await service.cancelForRound({ ...baseInput, customerNotice: 'ROUND_CANCELLED' });

    expect(notifications.sendToUser).toHaveBeenCalledWith(
      'user-1',
      'ORDER_CANCELLED',
      { orderId: '20261101-000003', reason: REFUND_NOTICE_REASONS.ROUND_CANCELLED },
      'order-1',
      'refund-notice:ROUND_CANCELLED:order-1',
    );
  });

  it.each([
    ['ADMIN_REFUND', REFUND_NOTICE_REASONS.ADMIN_REFUND],
    ['ROUND_CANCELLED', REFUND_NOTICE_REASONS.ROUND_CANCELLED],
  ] as const)('결제된 주문은 %s 고정 사유로 한 번만 안내한다', async (kind, reason) => {
    const { service, notifications } = makeLifecycle({ userId: 'user-1', status: 'ACCEPTED' });

    await service.cancelForRound({ ...baseInput, customerNotice: kind });

    expect(notifications.sendToUser).toHaveBeenCalledWith(
      'user-1',
      'ORDER_CANCELLED',
      { orderId: 'order-1', reason },
      'order-1',
      `refund-notice:${kind}:order-1`,
    );
  });

  it.each([
    ['결제 전 PENDING', { userId: 'user-1', status: 'PENDING' }],
    [
      '취소가 이미 끝난 주문',
      { userId: 'user-1', status: 'CANCELLED', cancellation: { status: 'COMPLETED' } },
    ],
  ])('%s은 안내하지 않는다', async (_label, order) => {
    const { service, notifications } = makeLifecycle(order);
    await service.cancelForRound({ ...baseInput, customerNotice: 'ROUND_CANCELLED' });
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('실패했던 취소를 다시 처리하면 안내하고 멱등 키로 중복을 막는다', async () => {
    const { service, notifications } = makeLifecycle({
      userId: 'user-1',
      status: 'CANCELLED',
      cancellation: { status: 'LOCAL_FAILED' },
    });
    await service.cancelForRound({ ...baseInput, customerNotice: 'ROUND_CANCELLED' });
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('안내 실패는 취소 결과를 바꾸지 않고, 안내 요청이 없으면 보내지 않는다', async () => {
    const failing = makeLifecycle({ userId: 'user-1', status: 'PREPARING' });
    failing.notifications.sendToUser.mockRejectedValue(new Error('ALIGO down'));
    await expect(
      failing.service.cancelForRound({ ...baseInput, customerNotice: 'ADMIN_REFUND' }),
    ).resolves.toEqual({ orderId: 'order-1', status: 'CANCELLED' });

    const silent = makeLifecycle({ userId: 'user-1', status: 'ACCEPTED' });
    await silent.service.cancelForRound(baseInput);
    expect(silent.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('취소 자체가 실패하면 안내하지 않는다', async () => {
    const { service, notifications, cancel } = makeLifecycle({
      userId: 'user-1',
      status: 'ACCEPTED',
    });
    cancel.mockRejectedValue(new Error('refund failed'));
    await expect(
      service.cancelForRound({ ...baseInput, customerNotice: 'ADMIN_REFUND' }),
    ).rejects.toThrow('refund failed');
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });
});

describe('늦은 결제 자동 환불 안내', () => {
  it('회차 한도가 없어 자동 환불한 결제는 고정 사유로 안내하고 접수 알림은 보내지 않는다', async () => {
    const memory = createInMemoryFirestore({
      'stores/store-1': { id: 'store-1', salesMode: 'round_direct', ownerId: 'seller-1' },
      'saleRounds/round-1': {
        id: 'round-1',
        storeId: 'store-1',
        status: 'OPEN',
        schedule: {
          orderOpenAt: '2026-07-14T00:00:00.000+09:00',
          orderCloseAt: '2099-07-20T00:00:00.000+09:00',
          timezone: 'Asia/Seoul',
        },
        deliveryRegion: { city: '이천시', enabled: true },
        limits: { maxDeliveryAddresses: 0, maxItemQuantity: 0 },
        counters: {
          reservedDeliveryAddresses: 0,
          reservedItemQuantity: 0,
          orderedDeliveryAddresses: 0,
          orderedItemQuantity: 0,
          heldOrderCount: 0,
        },
      },
      'saleRoundItems/round-item-1': {
        id: 'round-item-1',
        roundId: 'round-1',
        storeId: 'store-1',
        productId: 'product-1',
        productNameSnapshot: '미니 호접란',
        roundPrice: 50000,
        saleLimitQuantity: 20,
        reservedQuantity: 0,
        orderedQuantity: 0,
        status: 'ACTIVE',
      },
      'orders/order-late-1': {
        id: 'order-late-1',
        storeId: 'store-1',
        userId: 'user-1',
        status: 'CANCELLED',
        cancelReason: 'timeout',
        schemaVersion: 2,
        roundId: 'round-1',
        saleType: 'normal',
        totalAmount: 100000,
        deliveryAddress: { address: '경기도 이천시 중리천로 1', zipCode: '17373' },
        orderItems: [{ roundItemId: 'round-item-1', quantity: 2 }],
      },
    });
    const notifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
    const finalization = new PaymentFinalizationService(
      memory.firestore as never,
      { refund: jest.fn().mockResolvedValue(undefined), getPayment: jest.fn() } as never,
      notifications as never,
      { log: jest.fn() } as never,
      new OrderCapacityService(memory.firestore as never) as never,
      { createOrMergeIssue: jest.fn() } as never,
      { saveRecord: jest.fn().mockResolvedValue({}) } as never,
      { refundByOrderId: jest.fn() } as never,
    );
    const paymentData = {
      amount: { total: 100000 },
      status: 'PAID',
      method: { type: 'CARD' },
      transactionId: 'tx-late-1',
    } as never;

    await expect(
      finalization.finalizePaidOrder('order-late-1', paymentData),
    ).resolves.toMatchObject({
      reason: 'late_payment_refunded',
    });

    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(notifications.sendToUser).toHaveBeenCalledWith(
      'user-1',
      'ORDER_CANCELLED',
      { orderId: 'order-late-1', reason: REFUND_NOTICE_REASONS.LATE_PAYMENT },
      'order-late-1',
      'refund-notice:LATE_PAYMENT:order-late-1',
    );
  });
});
