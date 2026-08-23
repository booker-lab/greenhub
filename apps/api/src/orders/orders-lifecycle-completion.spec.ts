import { OrdersLifecycleService } from './orders-lifecycle.service';

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
  const service = new OrdersLifecycleService(
    firestore as never,
    notifications as never,
    {} as never,
    settlements as never,
    {} as never,
    roundLifecycle as never,
  );

  return { notifications, order: () => order, service, settlements };
}

describe('배송 완료 후속효과 복구 계약', () => {
  it('이미 DELIVERED인 주문도 누락된 정산과 완료 알림을 재조정한다', async () => {
    const context = makeService();

    await expect(
      (context.service as any).reconcileDeliveryCompletion('store-safe', 'order-safe'),
    ).resolves.toEqual({ orderId: 'order-safe', status: 'DELIVERED' });

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

    expect(context.settlements.createSettlement).toHaveBeenCalledTimes(2);
    expect(context.notifications.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('알림 실패 뒤 재조정은 멱등 정산을 재확인하고 완료 알림을 복구한다', async () => {
    const context = makeService();
    context.notifications.sendToUser
      .mockRejectedValueOnce(new Error('완료 알림 실패'))
      .mockResolvedValueOnce(undefined);

    await expect(
      (context.service as any).reconcileDeliveryCompletion('store-safe', 'order-safe'),
    ).rejects.toThrow('완료 알림 실패');
    await expect(
      (context.service as any).reconcileDeliveryCompletion('store-safe', 'order-safe'),
    ).resolves.toMatchObject({ status: 'DELIVERED' });

    expect(context.settlements.createSettlement).toHaveBeenCalledTimes(2);
    expect(context.notifications.sendToUser).toHaveBeenCalledTimes(2);
  });
});
