// 상태 전이 고객 알림은 결정적인 멱등 키로 한 번만 보내고, 배송 보류·재개를 반복해도 보류 회차
// 상한까지만 알림톡이 나간다. 정상적인 1회 보류·재개 알림과 종료 알림은 그대로 나간다.

import { Logger } from '@nestjs/common';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { NotificationsService } from '../notifications/notifications.service';
import { DriverOrderScopeService } from './driver-order-scope.service';
import type { OrderStatus } from './dto/update-status.dto';
import { OrderCapacityService } from './order-capacity.service';
import {
  exceedsDeliveryHoldNoticeLimit,
  groupTransitionNoticeScope,
  MAX_NOTIFIED_DELIVERY_HOLDS,
  orderTransitionNoticeKey,
  readDeliveryHoldCount,
  transitionHoldCycle,
} from './order-transition-notice';
import { OrdersLifecycleService } from './orders-lifecycle.service';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';

type Data = Record<string, any>;

const freeHold = {
  reasonCode: 'CUSTOMER_UNREACHABLE',
  reasonMessage: '연락 안 됨',
  customerResponsible: false,
};

function seed(orders: Record<string, Data>): Record<string, Data> {
  return {
    'stores/store-round': { id: 'store-round', ownerId: 'seller-1', salesMode: 'round_direct' },
    'stores/store-legacy': { id: 'store-legacy', ownerId: 'seller-1', salesMode: 'legacy' },
    'users/driver-1': { id: 'driver-1', role: 'driver', driverApproved: true },
    'users/consumer-1': { id: 'consumer-1', role: 'consumer', phone: '010-1111-2222' },
    'users/consumer-2': { id: 'consumer-2', role: 'consumer', phone: '010-3333-4444' },
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
    ...orders,
  };
}

const roundOrder = (overrides: Data = {}): Data => ({
  id: 'order-1',
  storeId: 'store-round',
  userId: 'consumer-1',
  saleType: 'normal',
  status: 'PREPARING',
  schemaVersion: 2,
  roundId: 'round-1',
  deliveryMethod: 'direct',
  driverId: null,
  ...overrides,
});

function makeLifecycle(memory: ReturnType<typeof createInMemoryFirestore>, notifications: unknown) {
  const firestore = memory.firestore as never;
  const payments = {
    processRefundByOrderId: jest.fn().mockResolvedValue(undefined),
    refundOrderChargesByOrderId: jest.fn().mockResolvedValue(undefined),
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
  return new OrdersLifecycleService(
    firestore,
    notifications as never,
    payments as never,
    settlements as never,
    capacity,
    roundLifecycle,
    driverScope,
  );
}

function mockNotifications() {
  return {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    sendToGroupParticipants: jest.fn().mockResolvedValue(undefined),
  };
}

type Lifecycle = ReturnType<typeof makeLifecycle>;

function transition(
  lifecycle: Lifecycle,
  storeId: string,
  requester: { id: string; role: string },
  status: OrderStatus,
  orderId = 'order-1',
) {
  return lifecycle.updateStatus(
    storeId,
    orderId,
    requester.id,
    (status === 'DELIVERY_HELD' ? { status, deliveryHold: freeHold } : { status }) as never,
    requester.role,
  );
}

const driver = { id: 'driver-1', role: 'driver' };
const seller = { id: 'seller-1', role: 'seller' };

describe('상태 전이 알림 멱등 키와 보류 회차', () => {
  it('보류 회차 번호는 저장된 횟수를 쓰고, 필드가 없던 주문은 보류 기록이 있으면 1로 본다', () => {
    expect(readDeliveryHoldCount({})).toBe(0);
    expect(readDeliveryHoldCount({ deliveryHold: { heldAt: '2026-10-01T00:00:00.000Z' } })).toBe(1);
    expect(readDeliveryHoldCount({ deliveryHoldCount: 4, deliveryHold: {} })).toBe(4);
    expect(readDeliveryHoldCount({ deliveryHoldCount: -1 })).toBe(0);
    expect(readDeliveryHoldCount({ deliveryHoldCount: '3', deliveryHold: {} })).toBe(1);
    expect(transitionHoldCycle({ deliveryHoldCount: 2 }, 'DELIVERY_HELD')).toBe(3);
    expect(transitionHoldCycle({ deliveryHoldCount: 2 }, 'DELIVERING')).toBe(2);
  });

  it('같은 전이는 같은 키가 되고, 보류 회차에 묶인 전이만 회차 번호가 붙는다', () => {
    expect(orderTransitionNoticeKey('o-1', 'ACCEPTED', 'PREPARING', 0)).toBe(
      'order-transition:o-1:ACCEPTED:PREPARING',
    );
    expect(orderTransitionNoticeKey('o-1', 'PREPARING', 'DELIVERING', 0)).toBe(
      'order-transition:o-1:PREPARING:DELIVERING',
    );
    expect(orderTransitionNoticeKey('o-1', 'PREPARING', 'DELIVERING', 2)).toBe(
      'order-transition:o-1:PREPARING:DELIVERING:hold-2',
    );
    expect(orderTransitionNoticeKey('o-1', 'DELIVERING', 'DELIVERY_HELD', 1)).toBe(
      'order-transition:o-1:DELIVERING:DELIVERY_HELD:hold-1',
    );
    expect(orderTransitionNoticeKey('o-1', 'DELIVERY_HELD', 'PREPARING', 1)).toBe(
      'order-transition:o-1:DELIVERY_HELD:PREPARING:hold-1',
    );
    // 배송 완료 재조정이 써 온 키와 같다(이미 보낸 완료 알림을 다시 보내지 않는다).
    expect(orderTransitionNoticeKey('o-1', 'DELIVERING', 'DELIVERED', 3)).toBe(
      'order-transition:o-1:DELIVERING:DELIVERED',
    );
    expect(orderTransitionNoticeKey('o-1', 'DELIVERING', 'HUB_ARRIVED', 1)).toBe(
      'order-transition:o-1:DELIVERING:HUB_ARRIVED',
    );
    // 취소는 어느 상태에서 왔든 한 번이다.
    for (const from of ['ACCEPTED', 'PREPARING', 'DELIVERY_HELD'] as const) {
      expect(orderTransitionNoticeKey('o-1', from, 'CANCELLED', 2)).toBe(
        'order-transition:o-1:CANCELLED',
      );
    }
    expect(groupTransitionNoticeScope('product-1', 'GROUP_PREPARING')).toBe(
      'order-transition-group:product-1:GROUP_PREPARING',
    );
  });

  it(`보류·재개 알림은 ${MAX_NOTIFIED_DELIVERY_HOLDS}회차까지만 보내고 종료 알림은 회차와 무관하다`, () => {
    for (let cycle = 0; cycle <= MAX_NOTIFIED_DELIVERY_HOLDS; cycle += 1) {
      expect(exceedsDeliveryHoldNoticeLimit('DELIVERING', 'DELIVERY_HELD', cycle)).toBe(false);
      expect(exceedsDeliveryHoldNoticeLimit('PREPARING', 'DELIVERING', cycle)).toBe(false);
    }
    const over = MAX_NOTIFIED_DELIVERY_HOLDS + 1;
    expect(exceedsDeliveryHoldNoticeLimit('DELIVERING', 'DELIVERY_HELD', over)).toBe(true);
    expect(exceedsDeliveryHoldNoticeLimit('DELIVERY_HELD', 'PREPARING', over)).toBe(true);
    expect(exceedsDeliveryHoldNoticeLimit('DELIVERY_HELD', 'DELIVERING', over)).toBe(true);
    expect(exceedsDeliveryHoldNoticeLimit('PREPARING', 'DELIVERING', over)).toBe(true);
    expect(exceedsDeliveryHoldNoticeLimit('DELIVERING', 'DELIVERED', over)).toBe(false);
    expect(exceedsDeliveryHoldNoticeLimit('DELIVERY_HELD', 'CANCELLED', over)).toBe(false);
  });
});

describe('보류·재개 반복 시 고객 알림', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('정상적인 1회 보류와 재개는 배송 시작·보류·재배송 예정 알림이 각각 한 번 나간다', async () => {
    const memory = createInMemoryFirestore(seed({ 'orders/order-1': roundOrder() }));
    const notifications = mockNotifications();
    const lifecycle = makeLifecycle(memory, notifications);

    await transition(lifecycle, 'store-round', driver, 'DELIVERING');
    await transition(lifecycle, 'store-round', driver, 'DELIVERY_HELD');
    await transition(lifecycle, 'store-round', driver, 'DELIVERING');

    expect(notifications.sendToUser.mock.calls.map((call) => [call[1], call[4]])).toEqual([
      ['ORDER_DELIVERING', 'order-transition:order-1:PREPARING:DELIVERING'],
      ['ORDER_DELIVERY_HELD', 'order-transition:order-1:DELIVERING:DELIVERY_HELD:hold-1'],
      ['ORDER_REDELIVERY_SCHEDULED', 'order-transition:order-1:DELIVERY_HELD:DELIVERING:hold-1'],
    ]);
    expect(memory.read('orders/order-1')).toMatchObject({
      status: 'DELIVERING',
      deliveryHoldCount: 1,
    });
    expect(memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(0);
  });

  it('기사가 보류와 재개를 반복해도 회차별 키로 보내고 상한 뒤 회차는 알림을 보내지 않는다', async () => {
    const memory = createInMemoryFirestore(
      seed({ 'orders/order-1': roundOrder({ status: 'DELIVERING', driverId: 'driver-1' }) }),
    );
    const notifications = mockNotifications();
    const lifecycle = makeLifecycle(memory, notifications);

    for (let cycle = 1; cycle <= 5; cycle += 1) {
      await transition(lifecycle, 'store-round', driver, 'DELIVERY_HELD');
      await transition(lifecycle, 'store-round', driver, 'DELIVERING');
    }

    const keys = notifications.sendToUser.mock.calls.map((call) => call[4]);
    expect(keys).toEqual([
      'order-transition:order-1:DELIVERING:DELIVERY_HELD:hold-1',
      'order-transition:order-1:DELIVERY_HELD:DELIVERING:hold-1',
      'order-transition:order-1:DELIVERING:DELIVERY_HELD:hold-2',
      'order-transition:order-1:DELIVERY_HELD:DELIVERING:hold-2',
      'order-transition:order-1:DELIVERING:DELIVERY_HELD:hold-3',
      'order-transition:order-1:DELIVERY_HELD:DELIVERING:hold-3',
    ]);
    // 상태 전이 자체는 막지 않는다.
    expect(memory.read('orders/order-1')).toMatchObject({
      status: 'DELIVERING',
      deliveryHoldCount: 5,
    });
    expect(memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(0);
    // 보내지 않은 알림은 주문 ID와 회차만 남긴다(고객 정보 없음).
    expect(warn).toHaveBeenCalledTimes(4);
    expect(String(warn.mock.calls[0][0])).toContain('orderId=order-1, holdCycle=4');
    expect(String(warn.mock.calls[0][0])).not.toContain('010');
  });

  it('판매자가 준비 중과 보류를 반복해도 보류 알림은 상한까지만 나간다', async () => {
    const memory = createInMemoryFirestore(seed({ 'orders/order-1': roundOrder() }));
    const notifications = mockNotifications();
    const lifecycle = makeLifecycle(memory, notifications);

    for (let cycle = 1; cycle <= 5; cycle += 1) {
      await transition(lifecycle, 'store-round', seller, 'DELIVERY_HELD');
      await transition(lifecycle, 'store-round', seller, 'PREPARING');
    }

    expect(notifications.sendToUser.mock.calls.map((call) => [call[1], call[4]])).toEqual([
      ['ORDER_DELIVERY_HELD', 'order-transition:order-1:PREPARING:DELIVERY_HELD:hold-1'],
      ['ORDER_DELIVERY_HELD', 'order-transition:order-1:PREPARING:DELIVERY_HELD:hold-2'],
      ['ORDER_DELIVERY_HELD', 'order-transition:order-1:PREPARING:DELIVERY_HELD:hold-3'],
    ]);
    expect(memory.read('orders/order-1')).toMatchObject({
      status: 'PREPARING',
      deliveryHoldCount: 5,
    });
  });

  it('예전(회차 아님) 주문의 판매자 보류 반복도 같은 상한을 따른다', async () => {
    const memory = createInMemoryFirestore(
      seed({
        'orders/order-1': {
          id: 'order-1',
          storeId: 'store-legacy',
          userId: 'consumer-1',
          saleType: 'normal',
          status: 'PREPARING',
          deliveryMethod: 'direct',
        },
      }),
    );
    const notifications = mockNotifications();
    const lifecycle = makeLifecycle(memory, notifications);

    for (let cycle = 1; cycle <= 5; cycle += 1) {
      await transition(lifecycle, 'store-legacy', seller, 'DELIVERY_HELD');
      await transition(lifecycle, 'store-legacy', seller, 'PREPARING');
    }

    expect(notifications.sendToUser).toHaveBeenCalledTimes(MAX_NOTIFIED_DELIVERY_HOLDS);
    expect(notifications.sendToUser.mock.calls.map((call) => call[4])).toEqual([
      'order-transition:order-1:PREPARING:DELIVERY_HELD:hold-1',
      'order-transition:order-1:PREPARING:DELIVERY_HELD:hold-2',
      'order-transition:order-1:PREPARING:DELIVERY_HELD:hold-3',
    ]);
    expect(memory.read('orders/order-1')).toMatchObject({ deliveryHoldCount: 5 });
  });
});

describe('실제 알림 발송 서비스와 함께 본 반복 발송 상한', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  function makeNotificationsService(memory: ReturnType<typeof createInMemoryFirestore>) {
    const aligo = {
      sendAlimtalk: jest.fn().mockResolvedValue({
        success: true,
        outcome: 'ACCEPTED',
        channel: 'alimtalk',
        message: '발송됨',
        alimtalkAttempts: 1,
        smsAttempts: 0,
        providerReceipt: 'receipt-1',
        attemptId: 'attempt-1',
      }),
    };
    const service = new NotificationsService(
      memory.firestore as never,
      aligo as never,
      {} as never,
      { createOrMergeIssue: jest.fn() } as never,
    );
    return { service, aligo };
  }

  it('기사가 보류·재개를 5번 반복해도 알림톡은 배송 시작 1번과 3회차 보류·재개 6번만 나간다', async () => {
    const memory = createInMemoryFirestore(seed({ 'orders/order-1': roundOrder() }));
    const { service, aligo } = makeNotificationsService(memory);
    const lifecycle = makeLifecycle(memory, service);

    await transition(lifecycle, 'store-round', driver, 'DELIVERING');
    for (let cycle = 1; cycle <= 5; cycle += 1) {
      await transition(lifecycle, 'store-round', driver, 'DELIVERY_HELD');
      await transition(lifecycle, 'store-round', driver, 'DELIVERING');
    }

    expect(aligo.sendAlimtalk).toHaveBeenCalledTimes(1 + MAX_NOTIFIED_DELIVERY_HOLDS * 2);
    expect(aligo.sendAlimtalk.mock.calls.map((call) => call[1])).toEqual([
      'ORDER_DELIVERING',
      'ORDER_DELIVERY_HELD',
      'ORDER_REDELIVERY_SCHEDULED',
      'ORDER_DELIVERY_HELD',
      'ORDER_REDELIVERY_SCHEDULED',
      'ORDER_DELIVERY_HELD',
      'ORDER_REDELIVERY_SCHEDULED',
    ]);
  });

  it('공동구매 참여 주문이 차례로 준비 중이 되어도 참여자마다 준비 알림은 한 번이다', async () => {
    const groupOrder = (id: string, userId: string): Data => ({
      id,
      storeId: 'store-legacy',
      userId,
      productId: 'product-g',
      productName: '공동구매 호접란',
      saleType: 'group',
      status: 'CONFIRMED',
      deliveryMethod: 'parcel',
    });
    const memory = createInMemoryFirestore(
      seed({
        'orders/order-g1': groupOrder('order-g1', 'consumer-1'),
        'orders/order-g2': groupOrder('order-g2', 'consumer-2'),
      }),
    );
    const { service, aligo } = makeNotificationsService(memory);
    const lifecycle = makeLifecycle(memory, service);

    await transition(lifecycle, 'store-legacy', seller, 'PREPARING', 'order-g1');
    await transition(lifecycle, 'store-legacy', seller, 'PREPARING', 'order-g2');

    expect(aligo.sendAlimtalk).toHaveBeenCalledTimes(2);
    expect(aligo.sendAlimtalk.mock.calls.map((call) => [call[0], call[1]]).sort()).toEqual([
      ['01011112222', 'GROUP_PREPARING'],
      ['01033334444', 'GROUP_PREPARING'],
    ]);
  });
});
