// 상태 전이는 (역할, 현재 상태, 배송 방법)으로 판정한다. 거점 도착은 픽업 코드가 있는 예전 거점 주문만,
// 거점 주문의 완료는 고객 픽업 확인으로만 되고, 회차 주문은 거점 도착으로 바뀌지 않는다.
// 배정 기사·관리자·판매자 모두 같은 배송 방법 제약을 받는다.

import { DRIVER_ORDER_AUTHORITY_DENIED, DRIVER_ORDER_STATE_CONFLICT } from '@greenhub/shared';
import { ForbiddenException } from '@nestjs/common';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { readHttpExceptionBody } from './driver-order-error';
import { DriverOrderScopeService } from './driver-order-scope.service';
import type { OrderStatus } from './dto/update-status.dto';
import { OrderCapacityService } from './order-capacity.service';
import { deliveryTransitionViolation } from './orders.helpers';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';
import { createSettledOrdersLifecycle } from '../../test/helpers/settled-orders-lifecycle';

type Data = Record<string, any>;

const legacyOrder = (overrides: Data = {}): Data => ({
  id: 'order-1',
  storeId: 'store-legacy',
  userId: 'consumer-1',
  productId: 'product-1',
  productName: '미니 호접란',
  saleType: 'normal',
  quantity: 1,
  status: 'DELIVERING',
  driverId: 'driver-1',
  ...overrides,
});

const roundOrder = (overrides: Data = {}): Data => ({
  id: 'order-1',
  storeId: 'store-round',
  userId: 'consumer-1',
  saleType: 'normal',
  status: 'DELIVERING',
  schemaVersion: 2,
  roundId: 'round-1',
  deliveryMethod: 'direct',
  driverId: 'driver-1',
  ...overrides,
});

function makeContext(order: Data) {
  const memory = createInMemoryFirestore({
    'stores/store-legacy': { id: 'store-legacy', ownerId: 'seller-1', salesMode: 'legacy' },
    'stores/store-round': { id: 'store-round', ownerId: 'seller-1', salesMode: 'round_direct' },
    'users/driver-1': { id: 'driver-1', role: 'driver', driverApproved: true },
    'users/driver-2': { id: 'driver-2', role: 'driver', driverApproved: true },
    'saleRounds/round-1': {
      id: 'round-1',
      storeId: 'store-round',
      counters: {
        reservedDeliveryAddresses: 0,
        reservedItemQuantity: 0,
        orderedDeliveryAddresses: 1,
        orderedItemQuantity: 1,
        heldOrderCount: 0,
      },
    },
    'orders/order-1': order,
  });
  const firestore = memory.firestore as never;
  const notifications = {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    sendToGroupParticipants: jest.fn().mockResolvedValue(undefined),
  };
  const payments = {
    processRefundByOrderId: jest.fn().mockResolvedValue(undefined),
    refundOrderChargesByOrderId: jest.fn().mockResolvedValue({ unsettledCount: 0 }),
  };
  const settlements = {
    createSettlement: jest.fn().mockResolvedValue(undefined),
    cancelSettlement: jest.fn().mockResolvedValue(undefined),
  };
  const driverScope = new DriverOrderScopeService(firestore);
  const capacity = new OrderCapacityService(firestore);
  const roundLifecycle = new RoundOrderLifecycleService(
    firestore,
    payments as never,
    settlements as never,
    capacity,
    driverScope,
  );
  const lifecycle = createSettledOrdersLifecycle(
    firestore,
    notifications as never,
    payments as never,
    settlements as never,
    capacity,
    roundLifecycle,
    driverScope,
  );
  const update = (requesterId: string, role: string, status: OrderStatus) =>
    lifecycle.updateStatus(
      String(order['storeId']),
      'order-1',
      requesterId,
      { status },
      role,
    );
  return { memory, notifications, settlements, lifecycle, update };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('거절되어야 하는 전이가 성공했습니다.');
}

describe('배송 방법별 상태 전이 판정표', () => {
  it.each<[string, OrderStatus, OrderStatus, Data, boolean]>([
    [
      '거점 주문(픽업 코드 있음)의 거점 도착',
      'DELIVERING',
      'HUB_ARRIVED',
      { deliveryMethod: 'hub', pickupCode: '123456' },
      true,
    ],
    ['직배송 주문의 거점 도착', 'DELIVERING', 'HUB_ARRIVED', { deliveryMethod: 'direct' }, false],
    ['택배 주문의 거점 도착', 'DELIVERING', 'HUB_ARRIVED', { deliveryMethod: 'parcel' }, false],
    [
      '픽업 코드 없는 거점 주문의 거점 도착',
      'DELIVERING',
      'HUB_ARRIVED',
      { deliveryMethod: 'hub', pickupCode: null },
      false,
    ],
    [
      '회차 직배송 주문의 거점 도착',
      'DELIVERING',
      'HUB_ARRIVED',
      { schemaVersion: 2, roundId: 'round-1', deliveryMethod: 'direct' },
      false,
    ],
    [
      '회차 표시가 남은 거점 주문의 거점 도착',
      'DELIVERING',
      'HUB_ARRIVED',
      { roundId: 'round-1', deliveryMethod: 'hub', pickupCode: '123456' },
      false,
    ],
    [
      '거점 주문의 배송 완료',
      'DELIVERING',
      'DELIVERED',
      { deliveryMethod: 'hub', pickupCode: '123456' },
      false,
    ],
    ['직배송 주문의 배송 완료', 'DELIVERING', 'DELIVERED', { deliveryMethod: 'direct' }, true],
    [
      '회차 직배송 주문의 배송 완료',
      'DELIVERING',
      'DELIVERED',
      { schemaVersion: 2, roundId: 'round-1', deliveryMethod: 'direct' },
      true,
    ],
    ['배송 방법을 모르는 주문의 배송 완료', 'DELIVERING', 'DELIVERED', {}, false],
    ['택배 주문의 발송 완료', 'PREPARING', 'DELIVERED', { deliveryMethod: 'parcel' }, true],
    [
      '직배송 주문의 준비 중 바로 완료',
      'PREPARING',
      'DELIVERED',
      { deliveryMethod: 'direct' },
      false,
    ],
    [
      '거점 주문의 준비 중 바로 완료',
      'PREPARING',
      'DELIVERED',
      { deliveryMethod: 'hub', pickupCode: '123456' },
      false,
    ],
    ['직배송 주문의 배송 시작', 'PREPARING', 'DELIVERING', { deliveryMethod: 'direct' }, true],
    ['거점 주문의 배송 시작', 'PREPARING', 'DELIVERING', { deliveryMethod: 'hub' }, true],
    ['택배 주문의 기사 배송 시작', 'PREPARING', 'DELIVERING', { deliveryMethod: 'parcel' }, false],
    [
      '택배 주문의 보류 뒤 기사 배송 재개',
      'DELIVERY_HELD',
      'DELIVERING',
      { deliveryMethod: 'parcel' },
      false,
    ],
    ['택배 주문의 배송 보류', 'PREPARING', 'DELIVERY_HELD', { deliveryMethod: 'parcel' }, true],
    ['거점 주문의 취소', 'DELIVERY_HELD', 'CANCELLED', { deliveryMethod: 'hub' }, true],
  ])('%s', (_name, current, next, order, allowed) => {
    expect(deliveryTransitionViolation(current, next, order) === null).toBe(allowed);
  });
});

describe('배정 기사의 배송 방법 밖 전이 차단', () => {
  it('회차 직배송 주문을 거점 도착으로 바꾸지 못하고 주문·알림·회차 집계가 그대로다', async () => {
    const context = makeContext(roundOrder());
    const before = context.memory.read('orders/order-1');

    const error = await rejection(context.update('driver-1', 'driver', 'HUB_ARRIVED'));

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(readHttpExceptionBody(error)).toMatchObject({
      code: DRIVER_ORDER_STATE_CONFLICT,
      message: '회차 주문은 거점 도착으로 바꿀 수 없습니다.',
    });
    expect(context.memory.read('orders/order-1')).toEqual(before);
    expect(context.memory.read('saleRounds/round-1')?.counters).toMatchObject({
      heldOrderCount: 0,
      orderedDeliveryAddresses: 1,
    });
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();
    expect(context.settlements.createSettlement).not.toHaveBeenCalled();
  });

  it('예전 직배송 주문도 거점 도착으로 바꾸지 못한다', async () => {
    const context = makeContext(legacyOrder({ deliveryMethod: 'direct' }));

    const error = await rejection(context.update('driver-1', 'driver', 'HUB_ARRIVED'));

    expect(readHttpExceptionBody(error)).toMatchObject({
      code: DRIVER_ORDER_STATE_CONFLICT,
      message: '거점 배송 주문만 거점 도착으로 바꿀 수 있습니다.',
    });
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'DELIVERING' });
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('픽업 코드가 없는 거점 주문은 거점 도착으로 바꾸지 못한다', async () => {
    const context = makeContext(legacyOrder({ deliveryMethod: 'hub', pickupCode: null }));

    const error = await rejection(context.update('driver-1', 'driver', 'HUB_ARRIVED'));

    expect(readHttpExceptionBody(error)).toMatchObject({ code: DRIVER_ORDER_STATE_CONFLICT });
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'DELIVERING' });
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('거점 주문은 배송 완료로 건너뛰지 못하고, 거점 도착 → 픽업 확인으로만 끝난다', async () => {
    const context = makeContext(
      legacyOrder({ deliveryMethod: 'hub', pickupCode: '123456', hubAddress: '이천 거점' }),
    );

    const skip = await rejection(context.update('driver-1', 'driver', 'DELIVERED'));
    expect(readHttpExceptionBody(skip)).toMatchObject({
      code: DRIVER_ORDER_STATE_CONFLICT,
      message: '거점 배송 주문은 고객 픽업 확인으로만 완료할 수 있습니다.',
    });
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'DELIVERING' });
    expect(context.settlements.createSettlement).not.toHaveBeenCalled();

    await expect(context.update('driver-1', 'driver', 'HUB_ARRIVED')).resolves.toEqual({
      orderId: 'order-1',
      status: 'HUB_ARRIVED',
    });
    expect(context.notifications.sendToUser).toHaveBeenCalledWith(
      'consumer-1',
      'ORDER_HUB_ARRIVED',
      expect.objectContaining({ pickupCode: '123456', hubAddress: '이천 거점' }),
      'order-1',
      'order-transition:order-1:DELIVERING:HUB_ARRIVED',
    );

    await expect(
      context.lifecycle.confirmPickup('store-legacy', 'order-1', 'consumer-1', '123456'),
    ).resolves.toEqual({ orderId: 'order-1', status: 'PICKED_UP' });
    expect(context.settlements.createSettlement).toHaveBeenCalledTimes(1);
  });

  it('다른 기사에게는 배송 방법 대신 기존 권한 오류만 보인다', async () => {
    const context = makeContext(legacyOrder({ deliveryMethod: 'direct' }));

    const error = await rejection(context.update('driver-2', 'driver', 'HUB_ARRIVED'));

    expect(readHttpExceptionBody(error)).toMatchObject({ code: DRIVER_ORDER_AUTHORITY_DENIED });
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'DELIVERING' });
  });
});

describe('관리자·판매자의 배송 방법 밖 전이 차단', () => {
  it('관리자도 거점 주문을 배송 완료로 건너뛰지 못한다', async () => {
    const context = makeContext(legacyOrder({ deliveryMethod: 'hub', pickupCode: '123456' }));

    await expect(context.update('admin-1', 'admin', 'DELIVERED')).rejects.toThrow(
      '거점 배송 주문은 고객 픽업 확인으로만 완료할 수 있습니다.',
    );
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'DELIVERING' });
    expect(context.settlements.createSettlement).not.toHaveBeenCalled();
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('관리자도 회차 주문을 거점 도착으로 바꾸지 못한다', async () => {
    const context = makeContext(roundOrder());

    await expect(context.update('admin-1', 'admin', 'HUB_ARRIVED')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'DELIVERING' });
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it.each([
    'direct',
    'hub',
  ])('판매자는 %s 주문을 준비 중에서 바로 배송 완료로 바꾸지 못한다', async (deliveryMethod) => {
    const context = makeContext(
      legacyOrder({ deliveryMethod, pickupCode: '123456', status: 'PREPARING', driverId: null }),
    );

    await expect(context.update('seller-1', 'seller', 'DELIVERED')).rejects.toThrow(
      '택배 발송 완료는 택배 주문에서만 가능합니다.',
    );
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'PREPARING' });
    expect(context.settlements.createSettlement).not.toHaveBeenCalled();
  });

  it('판매자의 택배 발송 완료는 그대로 된다', async () => {
    const context = makeContext(
      legacyOrder({ deliveryMethod: 'parcel', status: 'PREPARING', driverId: null }),
    );

    await expect(context.update('seller-1', 'seller', 'DELIVERED')).resolves.toEqual({
      orderId: 'order-1',
      status: 'DELIVERED',
    });
    expect(context.settlements.createSettlement).toHaveBeenCalledTimes(1);
  });
});
