import { ForbiddenException } from '@nestjs/common';
import { OrdersLifecycleService } from './orders-lifecycle.service';

function createSnap(data: Record<string, unknown> | null) {
  return {
    exists: data !== null,
    data: () => data,
  };
}

function createService(docs: Record<string, Record<string, unknown> | null>) {
  const updates: Array<{ path: string; data: Record<string, unknown> }> = [];
  const firestore = {
    doc: jest.fn((path: string) => ({
      get: jest.fn(async () => createSnap(docs[path] ?? null)),
      update: jest.fn(async (data: Record<string, unknown>) => {
        updates.push({ path, data });
      }),
    })),
    Timestamp: {
      now: jest.fn(() => 'now'),
    },
  };
  const settlements = { createSettlement: jest.fn(async () => undefined) };
  const service = new OrdersLifecycleService(
    firestore as never,
    {} as never,
    {} as never,
    settlements as never,
  );
  return { service, firestore, settlements, updates };
}

const hubOrder = {
  id: 'order-1',
  storeId: 'store-1',
  userId: 'consumer-1',
  hubId: 'hub-1',
  status: 'HUB_ARRIVED',
  pickupCode: '123456',
};

describe('OrdersLifecycleService hubConfirmPickup', () => {
  it('판매자 소유자는 기존 거점 픽업 확인 경로를 계속 사용할 수 있다', async () => {
    const { service, settlements, updates } = createService({
      'stores/store-1': { ownerId: 'seller-1' },
      'orders/order-1': hubOrder,
    });

    await expect(
      service.hubConfirmPickup('store-1', 'order-1', 'seller-1', '123456', { role: 'seller' }),
    ).resolves.toEqual({ orderId: 'order-1', status: 'PICKED_UP' });

    expect(updates).toContainEqual({
      path: 'orders/order-1',
      data: { status: 'PICKED_UP', updatedAt: 'now' },
    });
    expect(settlements.createSettlement).toHaveBeenCalledWith(hubOrder, 'PICKED_UP');
  });

  it('hub_staff는 JWT 스코프와 staffIds가 일치하는 거점 주문만 픽업 확인할 수 있다', async () => {
    const { service, updates } = createService({
      'stores/store-1': { ownerId: 'seller-1' },
      'orders/order-1': hubOrder,
      'hubs/hub-1': { storeId: 'store-1', staffIds: ['staff-1'] },
    });

    await expect(
      service.hubConfirmPickup('store-1', 'order-1', 'staff-1', '123456', {
        role: 'hub_staff',
        storeId: 'store-1',
        hubIds: ['hub-1'],
      }),
    ).resolves.toEqual({ orderId: 'order-1', status: 'PICKED_UP' });

    expect(updates).toContainEqual({
      path: 'orders/order-1',
      data: { status: 'PICKED_UP', updatedAt: 'now' },
    });
  });

  it('hub_staff가 JWT 스코프 밖의 거점 주문을 확인하면 차단한다', async () => {
    const { service, updates } = createService({
      'stores/store-1': { ownerId: 'seller-1' },
      'orders/order-1': hubOrder,
      'hubs/hub-1': { storeId: 'store-1', staffIds: ['staff-1'] },
    });

    await expect(
      service.hubConfirmPickup('store-1', 'order-1', 'staff-1', '123456', {
        role: 'hub_staff',
        storeId: 'store-1',
        hubIds: ['hub-2'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(updates).toEqual([]);
  });
});
