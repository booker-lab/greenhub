import { OrderNoticeDispatcher } from './order-notice-dispatcher';
import { OrdersLifecycleService } from './orders-lifecycle.service';

// 재시도 대기만 없앤 알림 실행기. 알림 처리 완료는 각 시험이 drain()으로 기다린다.
class ImmediateRetryNoticeDispatcher extends OrderNoticeDispatcher {
  protected override sleep(): Promise<void> {
    return Promise.resolve();
  }
}

type Data = Record<string, unknown>;

function makeService(overrides: Data = {}) {
  let order: Data = {
    id: 'order-safe',
    storeId: 'store-safe',
    userId: 'consumer-safe',
    driverId: 'driver-safe',
    schemaVersion: 2,
    roundId: 'round-safe',
    deliveryMethod: 'direct',
    status: 'DELIVERED',
    deliveryPhotoIds: ['photo-safe'],
    totalAmount: 50000,
    ...overrides,
  };
  const firestore = {
    doc: jest.fn((path: string) => ({
      get: jest.fn(async () => ({
        exists: path === 'orders/order-safe',
        data: () => (path === 'orders/order-safe' ? { ...order } : undefined),
      })),
    })),
  };
  const notifications = {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    sendToGroupParticipants: jest.fn(),
  };
  const settlements = {
    createSettlement: jest.fn().mockResolvedValue(undefined),
  };
  const roundLifecycle = {
    updateStatus: jest.fn(async () => {
      order = { ...order, status: 'DELIVERED' };
      return { orderId: 'order-safe', status: 'DELIVERED' };
    }),
  };
  const notices = new ImmediateRetryNoticeDispatcher();
  const service = new OrdersLifecycleService(
    firestore as never,
    notifications as never,
    {} as never,
    settlements as never,
    {} as never,
    roundLifecycle as never,
    undefined,
    notices,
  );

  return { notices, notifications, order: () => order, service, settlements };
}

describe('배송 완료 후속효과 복구 계약', () => {
  it('이미 DELIVERED인 주문도 누락된 정산과 완료 알림을 재조정한다', async () => {
    const context = makeService();

    await expect(
      (context.service as any).reconcileDeliveryCompletion('store-safe', 'order-safe'),
    ).resolves.toEqual({ orderId: 'order-safe', status: 'DELIVERED' });
    await context.notices.drain();

    expect(context.settlements.createSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-safe', status: 'DELIVERED' }),
      'DELIVERED',
    );
    expect(context.notifications.sendToUser).toHaveBeenCalledWith(
      'consumer-safe',
      'ORDER_DELIVERED',
      { orderId: 'order-safe' },
      'order-safe',
      'order-transition:order-safe:DELIVERING:DELIVERED',
    );
  });

  it('정산 실패 뒤 같은 재조정 요청이 정산과 완료 알림을 다시 처리한다', async () => {
    const context = makeService();
    context.settlements.createSettlement
      .mockRejectedValueOnce(new Error('정산 저장 실패'))
      .mockResolvedValueOnce(undefined);

    await expect(
      (context.service as any).reconcileDeliveryCompletion('store-safe', 'order-safe'),
    ).rejects.toThrow('정산 저장 실패');
    await expect(
      (context.service as any).reconcileDeliveryCompletion('store-safe', 'order-safe'),
    ).resolves.toMatchObject({ status: 'DELIVERED' });
    await context.notices.drain();

    expect(context.settlements.createSettlement).toHaveBeenCalledTimes(2);
    expect(context.notifications.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('알림 예외는 재조정 결과를 바꾸지 않고 같은 멱등 키로 다시 시도해 완료 알림을 보낸다', async () => {
    const context = makeService();
    context.notifications.sendToUser
      .mockRejectedValueOnce(new Error('완료 알림 실패'))
      .mockResolvedValueOnce(undefined);

    await expect(
      (context.service as any).reconcileDeliveryCompletion('store-safe', 'order-safe'),
    ).resolves.toMatchObject({ status: 'DELIVERED' });
    await context.notices.drain();

    expect(context.settlements.createSettlement).toHaveBeenCalledTimes(1);
    expect(context.notifications.sendToUser).toHaveBeenCalledTimes(2);
    expect(context.notifications.sendToUser.mock.calls[1]).toEqual(
      context.notifications.sendToUser.mock.calls[0],
    );
  });

  it('응답은 완료 알림 발송이 끝나기를 기다리지 않는다', async () => {
    const context = makeService();
    let releaseNotice!: () => void;
    context.notifications.sendToUser.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseNotice = resolve)),
    );

    await expect(
      (context.service as any).reconcileDeliveryCompletion('store-safe', 'order-safe'),
    ).resolves.toEqual({ orderId: 'order-safe', status: 'DELIVERED' });
    // 응답이 돌아온 시점에 알림은 아직 끝나지 않았다.
    let settled = false;
    const drained = context.notices.drain().then(() => (settled = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(context.notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    releaseNotice();
    await drained;
    expect(settled).toBe(true);
  });
});
