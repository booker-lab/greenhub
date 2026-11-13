// 상품 파손(PRODUCT_DAMAGED) 보류는 다시 배송하지 않는다. 배송 중인 기사만 남길 수 있고, 남긴 뒤에는
// 판매자의 주문 취소(전액 환불)로만 끝난다. 재배송 준비·배송 재개는 판매자·기사·관리자 모두 막는다.
// 수령 거부(RECEIPT_REFUSED)는 다른 고객 사유처럼 고객 책임·재배송비가 있어야 한다.

import { DRIVER_ORDER_STATE_CONFLICT } from '@greenhub/shared';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { createSettledOrdersLifecycle } from '../../test/helpers/settled-orders-lifecycle';
import { readHttpExceptionBody } from './driver-order-error';
import { DriverOrderScopeService } from './driver-order-scope.service';
import { DELIVERY_HOLD_REASONS, type OrderStatus } from './dto/update-status.dto';
import { OrderCapacityService } from './order-capacity.service';
import { DELIVERY_HOLD_CUSTOMER_REASONS } from './orders-lifecycle.service';
import { deliveryTransitionViolation } from './orders.helpers';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';

type Data = Record<string, any>;

const DAMAGED_HOLD = {
  heldAt: '2026-11-13T10:00:00.000Z',
  reasonCode: 'PRODUCT_DAMAGED',
  reasonMessage: '배송 중 화분이 깨졌어요.',
  customerResponsible: false,
  redeliveryFee: null,
  nextContactAt: null,
  nextDeliveryAt: null,
  resolvedAt: null,
};

function roundOrder(overrides: Data = {}): Data {
  return {
    id: 'order-1',
    storeId: 'store-round',
    userId: 'consumer-1',
    saleType: 'normal',
    status: 'DELIVERING',
    schemaVersion: 2,
    roundId: 'round-1',
    reservationId: 'reservation-1',
    orderItems: [{ roundItemId: 'round-item-1', quantity: 1 }],
    deliveryMethod: 'direct',
    driverId: 'driver-1',
    ...overrides,
  };
}

function makeContext(order: Data, heldOrderCount = 0) {
  const memory = createInMemoryFirestore({
    'stores/store-round': { id: 'store-round', ownerId: 'seller-1', salesMode: 'round_direct' },
    'users/driver-1': { id: 'driver-1', role: 'driver', driverApproved: true },
    'saleRounds/round-1': {
      id: 'round-1',
      storeId: 'store-round',
      status: 'OPEN',
      schedule: { orderCloseAt: '2026-11-01T00:00:00.000+09:00' },
      counters: {
        reservedDeliveryAddresses: 0,
        reservedItemQuantity: 0,
        orderedDeliveryAddresses: 1,
        orderedItemQuantity: 1,
        heldOrderCount,
      },
    },
    'saleRoundItems/round-item-1': {
      id: 'round-item-1',
      roundId: 'round-1',
      storeId: 'store-round',
      productId: 'product-1',
      reservedQuantity: 0,
      orderedQuantity: 1,
      status: 'ACTIVE',
    },
    'checkoutReservations/reservation-1': {
      id: 'reservation-1',
      roundId: 'round-1',
      storeId: 'store-round',
      userId: 'consumer-1',
      orderId: 'order-1',
      paymentId: 'order-1',
      status: 'CONSUMED',
      addressKey: 'test',
      deliveryAddressCount: 1,
      itemQuantityTotal: 1,
      items: [{ roundItemId: 'round-item-1', productId: 'product-1', quantity: 1, unitPrice: 50000 }],
      idempotencyKey: 'checkout-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
      consumedAt: '2026-11-01T00:00:00.000Z',
      releasedAt: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
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
  const update = (requesterId: string, role: string, dto: Data) =>
    lifecycle.updateStatus('store-round', 'order-1', requesterId, dto as never, role);
  return { memory, notifications, payments, settlements, update };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('거절되어야 하는 요청이 성공했습니다.');
}

const damagedHoldInput = {
  reasonCode: 'PRODUCT_DAMAGED',
  reasonMessage: '배송 중 화분이 깨졌어요.',
  customerResponsible: false,
  redeliveryFee: null,
  nextContactAt: null,
  nextDeliveryAt: null,
};

describe('보류 사유 코드 목록', () => {
  it('DTO와 고객 알림 사유가 수령 거부·상품 파손을 받는다', () => {
    expect(DELIVERY_HOLD_REASONS).toEqual(
      expect.arrayContaining(['RECEIPT_REFUSED', 'PRODUCT_DAMAGED']),
    );
    expect(DELIVERY_HOLD_CUSTOMER_REASONS['PRODUCT_DAMAGED']).toBe(
      '배송 중 상품이 파손되어 배송하지 못했습니다.',
    );
    expect(DELIVERY_HOLD_CUSTOMER_REASONS['RECEIPT_REFUSED']).toBe(
      '수령을 거부하셔서 배송하지 못했습니다.',
    );
    // 모든 DTO 사유 코드에 고객 알림 문구가 있어야 보류 알림이 사유 코드로 거절되지 않는다.
    for (const code of DELIVERY_HOLD_REASONS) {
      expect(DELIVERY_HOLD_CUSTOMER_REASONS[code]).toEqual(expect.any(String));
    }
  });
});

describe('상품 파손 보류 남기기', () => {
  it('배송 중인 배정 기사는 남길 수 있고, 고정 사유로 보류 알림이 간다', async () => {
    const context = makeContext(roundOrder());

    await expect(
      context.update('driver-1', 'driver', {
        status: 'DELIVERY_HELD',
        deliveryHold: damagedHoldInput,
      }),
    ).resolves.toEqual({ orderId: 'order-1', status: 'DELIVERY_HELD' });

    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'DELIVERY_HELD',
      deliveryHold: expect.objectContaining({
        reasonCode: 'PRODUCT_DAMAGED',
        customerResponsible: false,
        redeliveryFee: null,
        resolvedAt: null,
      }),
    });
    expect(context.memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(1);
    expect(context.notifications.sendToUser).toHaveBeenCalledWith(
      'consumer-1',
      'ORDER_DELIVERY_HELD',
      expect.objectContaining({ reason: '배송 중 상품이 파손되어 배송하지 못했습니다.' }),
      'order-1',
      expect.any(String),
    );
  });

  it('수거 전(PREPARING) 기사 보류로는 남길 수 없다', async () => {
    const context = makeContext(roundOrder({ status: 'PREPARING' }));

    const error = await rejection(
      context.update('driver-1', 'driver', {
        status: 'DELIVERY_HELD',
        deliveryHold: damagedHoldInput,
      }),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'PREPARING' });
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it.each(['seller', 'admin'])('%s는 남길 수 없다', async (role) => {
    const context = makeContext(roundOrder());

    const error = await rejection(
      context.update(`${role}-1`, role, { status: 'DELIVERY_HELD', deliveryHold: damagedHoldInput }),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'DELIVERING' });
    expect(context.memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(0);
  });

  it('고객 책임·재배송비를 붙이면 거절한다', async () => {
    for (const overrides of [{ customerResponsible: true }, { redeliveryFee: 10_000 }]) {
      const context = makeContext(roundOrder());
      const error = await rejection(
        context.update('driver-1', 'driver', {
          status: 'DELIVERY_HELD',
          deliveryHold: { ...damagedHoldInput, ...overrides },
        }),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'DELIVERING' });
    }
  });
});

describe('상품 파손 보류는 취소로만 끝난다', () => {
  const heldOrder = () => roundOrder({ status: 'DELIVERY_HELD', deliveryHold: DAMAGED_HOLD });

  it.each<[string, OrderStatus, boolean]>([
    ['재배송 준비', 'PREPARING', false],
    ['배송 재개', 'DELIVERING', false],
    ['배송 완료', 'DELIVERED', false],
    ['주문 취소', 'CANCELLED', true],
  ])('판정표: %s', (_name, next, allowed) => {
    expect(deliveryTransitionViolation('DELIVERY_HELD', next, heldOrder()) === null).toBe(allowed);
  });

  it('다른 보류 사유는 재배송 준비·배송 재개를 그대로 허용한다', () => {
    for (const reasonCode of ['WEATHER', 'RECEIPT_REFUSED', 'ACCESS_UNAVAILABLE']) {
      const order = roundOrder({
        status: 'DELIVERY_HELD',
        deliveryHold: { ...DAMAGED_HOLD, reasonCode },
      });
      expect(deliveryTransitionViolation('DELIVERY_HELD', 'PREPARING', order)).toBeNull();
      expect(deliveryTransitionViolation('DELIVERY_HELD', 'DELIVERING', order)).toBeNull();
    }
  });

  it('배정 기사는 배송을 재개하지 못한다', async () => {
    const context = makeContext(heldOrder(), 1);
    const before = context.memory.read('orders/order-1');

    const error = await rejection(context.update('driver-1', 'driver', { status: 'DELIVERING' }));

    expect(readHttpExceptionBody(error)).toMatchObject({ code: DRIVER_ORDER_STATE_CONFLICT });
    expect(context.memory.read('orders/order-1')).toEqual(before);
    expect(context.memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(1);
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('판매자는 재배송 준비로 돌리지 못한다', async () => {
    const context = makeContext(heldOrder(), 1);
    const before = context.memory.read('orders/order-1');

    const error = await rejection(context.update('seller-1', 'seller', { status: 'PREPARING' }));

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(context.memory.read('orders/order-1')).toEqual(before);
    expect(context.memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(1);
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it.each<OrderStatus>([
    'PREPARING',
    'DELIVERING',
  ])('관리자도 %s(으)로 돌리지 못한다', async (next) => {
    const context = makeContext(heldOrder(), 1);
    const before = context.memory.read('orders/order-1');

    const error = await rejection(context.update('admin-1', 'admin', { status: next }));

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(context.memory.read('orders/order-1')).toEqual(before);
  });

  it('판매자 취소는 전액 환불하고 보류 집계·정산을 정리한 뒤 취소 알림을 보낸다', async () => {
    const context = makeContext(heldOrder(), 1);

    await expect(
      context.update('seller-1', 'seller', { status: 'CANCELLED', reason: '상품 파손' }),
    ).resolves.toEqual({ orderId: 'order-1', status: 'CANCELLED' });

    expect(context.payments.processRefundByOrderId).toHaveBeenCalledWith('order-1', '상품 파손');
    expect(context.payments.refundOrderChargesByOrderId).toHaveBeenCalledWith(
      'order-1',
      '상품 파손',
    );
    expect(context.settlements.cancelSettlement).toHaveBeenCalledWith('order-1');
    const saved = context.memory.read('orders/order-1') as Data;
    expect(saved).toMatchObject({
      status: 'CANCELLED',
      cancellation: expect.objectContaining({ status: 'COMPLETED' }),
    });
    expect(saved['deliveryHold']['resolvedAt']).toEqual(expect.any(String));
    expect(context.memory.read('saleRounds/round-1')?.counters).toMatchObject({
      heldOrderCount: 0,
      orderedDeliveryAddresses: 0,
      orderedItemQuantity: 0,
    });
    expect(context.notifications.sendToUser).toHaveBeenCalledWith(
      'consumer-1',
      'ORDER_CANCELLED',
      expect.objectContaining({ reason: '상품 파손' }),
      'order-1',
      expect.any(String),
    );
  });
});

describe('수령 거부 보류', () => {
  const refusedInput = {
    reasonCode: 'RECEIPT_REFUSED',
    reasonMessage: '받는 분이 수령을 거부했어요.',
    nextContactAt: null,
    nextDeliveryAt: null,
  };

  it('고객 책임·재배송비가 있으면 기사·판매자 모두 남길 수 있다', async () => {
    for (const [requesterId, role] of [
      ['driver-1', 'driver'],
      ['seller-1', 'seller'],
    ]) {
      const context = makeContext(roundOrder());
      await expect(
        context.update(requesterId, role, {
          status: 'DELIVERY_HELD',
          deliveryHold: { ...refusedInput, customerResponsible: true, redeliveryFee: 10_000 },
        }),
      ).resolves.toEqual({ orderId: 'order-1', status: 'DELIVERY_HELD' });
      expect(context.notifications.sendToUser).toHaveBeenCalledWith(
        'consumer-1',
        'ORDER_DELIVERY_HELD',
        expect.objectContaining({ reason: '수령을 거부하셔서 배송하지 못했습니다.' }),
        'order-1',
        expect.any(String),
      );
    }
  });

  it('고객 책임이 아니거나 재배송비가 없으면 거절한다', async () => {
    for (const overrides of [
      { customerResponsible: false, redeliveryFee: null },
      { customerResponsible: true, redeliveryFee: null },
    ]) {
      const context = makeContext(roundOrder());
      const error = await rejection(
        context.update('driver-1', 'driver', {
          status: 'DELIVERY_HELD',
          deliveryHold: { ...refusedInput, ...overrides },
        }),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect(context.memory.read('orders/order-1')).toMatchObject({ status: 'DELIVERING' });
    }
  });
});
