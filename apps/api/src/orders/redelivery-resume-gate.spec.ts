import { ConflictException, ForbiddenException } from '@nestjs/common';
import { OrderChargePaymentService } from '../payments/order-charge-payment.service';
import { OrderChargesService } from './order-charges.service';
import { OrdersLifecycleService } from './orders-lifecycle.service';
import { OrdersQueryService } from './orders-query.service';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';

type Data = Record<string, any>;

const holdAt = '2026-08-26T00:00:00.000Z';

function makeContext(options: {
  status?: 'DELIVERY_HELD' | 'PREPARING';
  chargeStatus?: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  omitCharge?: boolean;
  chargeOverrides?: Data;
  orderOverrides?: Data;
} = {}) {
  const order: Data = {
    id: 'order-1',
    schemaVersion: 2,
    roundId: 'round-1',
    saleType: 'normal',
    storeId: 'store-1',
    userId: 'consumer-1',
    driverId: 'driver-1',
    status: options.status ?? 'DELIVERY_HELD',
    deliveryMethod: 'direct',
    deliveryHold: {
      heldAt: holdAt,
      reasonCode: 'ACCESS_UNAVAILABLE',
      reasonMessage: '배송지 출입 불가',
      customerResponsible: true,
      redeliveryFee: 5_000,
      nextContactAt: null,
      nextDeliveryAt: null,
      resolvedAt: null,
    },
    redeliveryChargeId: 'charge-1',
    redeliveryChargeHoldAt: holdAt,
    ...options.orderOverrides,
  };
  const records: Record<string, Data> = {
    'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
    'saleRounds/round-1': {
      id: 'round-1',
      storeId: 'store-1',
      counters: {
        reservedDeliveryAddresses: 0,
        reservedItemQuantity: 0,
        orderedDeliveryAddresses: 0,
        orderedItemQuantity: 0,
        heldOrderCount: options.status === 'PREPARING' ? 1 : 1,
      },
    },
    'orders/order-1': order,
  };
  if (!options.omitCharge) {
    records['orderCharges/charge-1'] = {
      id: 'charge-1',
      orderId: 'order-1',
      storeId: 'store-1',
      userId: 'consumer-1',
      type: 'REDELIVERY_FEE',
      status: options.chargeStatus ?? 'PENDING',
      amount: 5_000,
      customerResponsible: true,
      holdAt,
      portonePaymentId: 'order-charge-charge-1',
      ...options.chargeOverrides,
    };
  }

  const memory = createInMemoryFirestore(records);
  const firestore = memory.firestore as never;
  const notifications = {
    sendToUser: jest.fn().mockResolvedValue(undefined),
    sendToGroupParticipants: jest.fn().mockResolvedValue(undefined),
  };
  const payments = {
    processRefundByOrderId: jest.fn().mockResolvedValue(undefined),
    refundOrderChargesByOrderId: jest.fn().mockResolvedValue(undefined),
  };
  const settlements = {
    createSettlement: jest.fn().mockResolvedValue(undefined),
    cancelSettlement: jest.fn().mockResolvedValue(undefined),
  };
  const capacity = {
    releaseReservation: jest.fn().mockResolvedValue(undefined),
    releaseReservationInTransaction: jest.fn().mockResolvedValue(undefined),
  };
  const roundLifecycle = new RoundOrderLifecycleService(
    firestore,
    payments as never,
    settlements as never,
    capacity as never,
  );
  const lifecycle = new OrdersLifecycleService(
    firestore,
    notifications as never,
    payments as never,
    settlements as never,
    capacity as never,
    roundLifecycle,
  );

  return { memory, firestore, lifecycle, notifications, payments, settlements };
}

async function resume(context: ReturnType<typeof makeContext>, requesterId = 'driver-1') {
  return context.lifecycle.updateStatus(
    'store-1',
    'order-1',
    requesterId,
    { status: 'DELIVERING' } as never,
    'driver',
  );
}

describe('유료 재배송 서버 불변식', () => {
  it.each(['PENDING', 'FAILED', 'REFUNDED'] as const)(
    '%s charge의 직접 배송 재개는 persistent side effect 없이 거부한다',
    async (chargeStatus) => {
      const context = makeContext({ chargeStatus });
      const beforeOrder = context.memory.read('orders/order-1');
      const beforeRound = context.memory.read('saleRounds/round-1');

      await expect(resume(context)).rejects.toBeInstanceOf(ConflictException);

      expect(context.memory.read('orders/order-1')).toEqual(beforeOrder);
      expect(context.memory.read('saleRounds/round-1')).toEqual(beforeRound);
      expect(context.notifications.sendToUser).not.toHaveBeenCalled();
    },
  );

  it('charge가 없거나 과거 hold에 연결된 PAID charge면 직접 재개를 거부한다', async () => {
    for (const options of [
      { omitCharge: true },
      { chargeStatus: 'PAID' as const, chargeOverrides: { holdAt: '2026-08-01T00:00:00.000Z' } },
    ]) {
      const context = makeContext(options);
      const beforeOrder = context.memory.read('orders/order-1');
      const beforeRound = context.memory.read('saleRounds/round-1');

      await expect(resume(context)).rejects.toBeInstanceOf(ConflictException);

      expect(context.memory.read('orders/order-1')).toEqual(beforeOrder);
      expect(context.memory.read('saleRounds/round-1')).toEqual(beforeRound);
      expect(context.notifications.sendToUser).not.toHaveBeenCalled();
    }
  });

  it('현재 hold에 연결된 PAID charge만 직접 재개하고 해소·counter를 한 번 처리한다', async () => {
    const context = makeContext({ chargeStatus: 'PAID' });

    await expect(resume(context)).resolves.toEqual({ orderId: 'order-1', status: 'DELIVERING' });
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'DELIVERING',
      driverId: 'driver-1',
      deliveryHold: { heldAt: holdAt, resolvedAt: expect.any(String) },
    });
    expect(context.memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(0);
    expect(context.notifications.sendToUser).toHaveBeenCalledWith(
      'consumer-1',
      'ORDER_REDELIVERY_SCHEDULED',
      { orderId: 'order-1' },
      'order-1',
      undefined,
    );

    await expect(resume(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(context.memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(0);
    expect(context.notifications.sendToUser).toHaveBeenCalledTimes(1);
  });

  it('유료 hold의 HELD → PREPARING은 obligation·linkage·counter를 유지한다', async () => {
    const context = makeContext({ chargeStatus: 'PENDING' });

    await expect(
      context.lifecycle.updateStatus(
        'store-1',
        'order-1',
        'seller-1',
        { status: 'PREPARING' } as never,
        'seller',
      ),
    ).resolves.toEqual({ orderId: 'order-1', status: 'PREPARING' });

    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'PREPARING',
      redeliveryChargeId: 'charge-1',
      redeliveryChargeHoldAt: holdAt,
      deliveryHold: { heldAt: holdAt, resolvedAt: null },
    });
    expect(context.memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(1);
    expect(context.notifications.sendToUser).toHaveBeenCalledWith(
      'consumer-1',
      'ORDER_REDELIVERY_PAYMENT_REQUESTED',
      { orderId: 'order-1' },
      'order-1',
      undefined,
    );

    const beforeOrder = context.memory.read('orders/order-1');
    await expect(resume(context)).rejects.toBeInstanceOf(ConflictException);
    expect(context.memory.read('orders/order-1')).toEqual(beforeOrder);
    expect(context.memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(1);
    expect(context.notifications.sendToUser).toHaveBeenCalledTimes(1);

    await context.firestore.doc('orderCharges/charge-1').update({ status: 'PAID' });
    await expect(resume(context)).resolves.toMatchObject({ status: 'DELIVERING' });
    expect(context.memory.read('orders/order-1')?.deliveryHold).toMatchObject({
      heldAt: holdAt,
      resolvedAt: expect.any(String),
    });
    expect(context.memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(0);
    expect(context.notifications.sendToUser).toHaveBeenLastCalledWith(
      'consumer-1',
      'ORDER_REDELIVERY_SCHEDULED',
      { orderId: 'order-1' },
      'order-1',
      undefined,
    );
  });

  it('무료 또는 판매자 책임 hold는 결제 없이 기존 해소를 유지하고 결제 요청 알림을 보내지 않는다', async () => {
    const context = makeContext({
      orderOverrides: {
        redeliveryChargeId: null,
        redeliveryChargeHoldAt: null,
        deliveryHold: {
          heldAt: holdAt,
          reasonCode: 'OTHER',
          reasonMessage: '판매자 배송 처리 지연',
          customerResponsible: false,
          redeliveryFee: null,
          nextContactAt: null,
          nextDeliveryAt: null,
          resolvedAt: null,
        },
      },
      omitCharge: true,
    });

    await expect(
      context.lifecycle.updateStatus(
        'store-1',
        'order-1',
        'seller-1',
        { status: 'PREPARING' } as never,
        'seller',
      ),
    ).resolves.toMatchObject({ status: 'PREPARING' });

    expect(context.memory.read('orders/order-1')?.deliveryHold).toMatchObject({
      resolvedAt: expect.any(String),
    });
    expect(context.memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(0);
    expect(context.notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('PREPARING에서도 현재 unresolved 유료 hold의 charge를 생성하고 멱등 재사용한다', async () => {
    const context = makeContext({
      status: 'PREPARING',
      orderOverrides: { redeliveryChargeId: null, redeliveryChargeHoldAt: null },
      omitCharge: true,
    });
    const charges = new OrderChargesService(context.firestore, {
      createOrMergeIssue: jest.fn(),
    } as never);

    const first = await charges.createRedeliveryFeeCharge({
      storeId: 'store-1',
      orderId: 'order-1',
      requesterId: 'consumer-1',
      idempotencyKey: 'retry-1',
    });
    const second = await charges.createRedeliveryFeeCharge({
      storeId: 'store-1',
      orderId: 'order-1',
      requesterId: 'consumer-1',
      idempotencyKey: 'retry-1',
    });

    expect(first.id).toBe(second.id);
    expect(context.memory.read(`orderCharges/${first.id}`)).toMatchObject({
      status: 'PENDING',
      type: 'REDELIVERY_FEE',
      holdAt,
    });
    expect(context.memory.read('orders/order-1')).toMatchObject({
      redeliveryChargeId: first.id,
      redeliveryChargeHoldAt: holdAt,
    });
  });

  it('조회 응답은 현재 재배송 결제의 actionability와 fail-closed 상태를 노출한다', async () => {
    const context = makeContext({ chargeStatus: 'PENDING' });
    const query = new OrdersQueryService(context.firestore);

    await expect(
      query.getOrderById('order-1', { sub: 'consumer-1', role: 'consumer' }),
    ).resolves.toMatchObject({
      redeliveryPayment: {
        required: true,
        holdAt,
        chargeId: 'charge-1',
        status: 'PENDING',
        canPay: true,
        paid: false,
        requiresRecovery: false,
      },
    });
  });

  it('동시에 두 기사가 재개해도 한 요청만 성공하고 counter는 한 번 감소한다', async () => {
    const context = makeContext({
      status: 'PREPARING',
      chargeStatus: 'PAID',
      orderOverrides: { driverId: null },
    });

    const results = await Promise.allSettled([resume(context, 'driver-1'), resume(context, 'driver-2')]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(context.memory.read('orders/order-1')).toMatchObject({
      status: 'DELIVERING',
      driverId: expect.stringMatching(/^driver-[12]$/),
    });
    expect(context.memory.read('saleRounds/round-1')?.counters.heldOrderCount).toBe(0);
  });

  it('현재 hold linkage가 있는 PAID 결제 webhook만 charge를 PAID로 확정한다', async () => {
    const context = makeContext({ chargeStatus: 'PENDING' });
    const portone = {
      getPayment: jest.fn().mockResolvedValue({
        status: 'PAID',
        amount: { total: 5_000 },
        method: { type: 'CARD' },
        transactionId: 'transaction-1',
      }),
    };
    const service = new OrderChargePaymentService(context.firestore, portone as never);

    await expect(service.handleWebhook('Transaction.Paid', 'order-charge-charge-1')).resolves.toMatchObject({
      status: 'PAID',
    });
    expect(context.memory.read('orderCharges/charge-1')).toMatchObject({ status: 'PAID', holdAt });
  });
});
