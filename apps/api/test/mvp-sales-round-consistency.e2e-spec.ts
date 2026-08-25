import { ForbiddenException } from '@nestjs/common';
import { OrderCapacityService } from '../src/orders/order-capacity.service';
import { OrdersQueryService } from '../src/orders/orders-query.service';
import { RoundOrderLifecycleService } from '../src/orders/round-order-lifecycle.service';
import { PaymentFinalizationService } from '../src/payments/payment-finalization.service';
import { SaleRoundStateService } from '../src/sale-rounds/sale-round-state.service';
import { createInMemoryFirestore } from './helpers/in-memory-firestore';

type Data = Record<string, any>;

const counters = {
  reservedDeliveryAddresses: 1,
  reservedItemQuantity: 2,
  orderedDeliveryAddresses: 0,
  orderedItemQuantity: 0,
  heldOrderCount: 0,
};

function baseRecords(): Record<string, Data> {
  return {
    'stores/store-1': { id: 'store-1', ownerId: 'seller-1' },
    'saleRounds/round-1': {
      id: 'round-1',
      storeId: 'store-1',
      status: 'OPEN',
      closeReason: null,
      schedule: {
        orderOpenAt: '2026-07-01T00:00:00.000Z',
        orderCloseAt: '2099-07-20T00:00:00.000Z',
      },
      limits: { maxDeliveryAddresses: 15, maxItemQuantity: 30 },
      counters,
    },
    'saleRoundItems/item-1': {
      id: 'item-1',
      roundId: 'round-1',
      storeId: 'store-1',
      productId: 'product-1',
      productNameSnapshot: '호접란',
      productImageUrlSnapshot: null,
      roundPrice: 20_000,
      saleLimitQuantity: 30,
      reservedQuantity: 2,
      orderedQuantity: 0,
      status: 'ACTIVE',
    },
    'checkoutReservations/reservation-1': {
      id: 'reservation-1',
      roundId: 'round-1',
      storeId: 'store-1',
      userId: 'consumer-1',
      orderId: null,
      paymentId: null,
      status: 'HELD',
      addressKey: 'address-key',
      deliveryAddressCount: 1,
      itemQuantityTotal: 2,
      items: [
        {
          roundItemId: 'item-1',
          productId: 'product-1',
          productName: '호접란',
          productImageUrl: null,
          quantity: 2,
          unitPrice: 20_000,
        },
      ],
      idempotencyKey: 'request-1',
      expiresAt: '2099-07-20T00:00:00.000Z',
      consumedAt: null,
      releasedAt: null,
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:00.000Z',
    },
    'orders/order-1': {
      id: 'order-1',
      schemaVersion: 2,
      saleType: 'normal',
      storeId: 'store-1',
      roundId: 'round-1',
      reservationId: 'reservation-1',
      userId: 'consumer-1',
      status: 'PENDING',
      totalAmount: 40_000,
      orderItems: [{ roundItemId: 'item-1', quantity: 2 }],
    },
  };
}

function makeFixture(overrides: Record<string, Data> = {}) {
  const memory = createInMemoryFirestore({ ...baseRecords(), ...overrides });
  const firestore = memory.firestore as never;
  const capacity = new OrderCapacityService(firestore);
  const payments = {
    processRefundByOrderId: jest.fn(async (orderId: string) => {
      const paymentRef = (firestore as any).doc(`payments/${orderId}`);
      const paymentSnap = await paymentRef.get();
      if (paymentSnap.exists) {
        await paymentRef.update({
          status: 'CANCELLED',
          refundAmount: paymentSnap.data()?.amount,
          refundedAt: new Date(),
        });
      }
    }),
    refundOrderChargesByOrderId: jest.fn().mockResolvedValue(undefined),
  };
  const settlements = { cancelSettlement: jest.fn().mockResolvedValue(undefined) };
  const lifecycle = new RoundOrderLifecycleService(
    firestore,
    payments as never,
    settlements as never,
    capacity,
  );
  const roundState = new SaleRoundStateService(firestore, lifecycle);
  const queries = new OrdersQueryService(firestore);
  const finalization = new PaymentFinalizationService(
    firestore,
    {} as never,
    { sendToUser: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    capacity,
    {} as never,
    { saveRecord: jest.fn().mockResolvedValue(undefined) } as never,
    { refundByOrderId: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { ...memory, capacity, payments, lifecycle, roundState, queries, finalization };
}

describe('회차 직배송 실제 서비스 정합성', () => {
  it('결제 확정은 예약·회차·상품·주문을 한 번만 확정한다', async () => {
    const fixture = makeFixture();
    const payment = {
      amount: { total: 40_000 },
      status: 'PAID',
      method: { type: 'CARD' },
      transactionId: 'transaction-1',
    };

    await fixture.finalization.finalizePaidOrder('order-1', payment as never);
    await fixture.finalization.finalizePaidOrder('order-1', payment as never);

    expect(fixture.read('orders/order-1')).toMatchObject({ status: 'ACCEPTED' });
    expect(fixture.read('checkoutReservations/reservation-1')).toMatchObject({
      status: 'CONSUMED',
      orderId: 'order-1',
      paymentId: 'order-1',
    });
    expect(fixture.read('saleRounds/round-1')?.counters).toEqual({
      reservedDeliveryAddresses: 0,
      reservedItemQuantity: 0,
      orderedDeliveryAddresses: 1,
      orderedItemQuantity: 2,
      heldOrderCount: 0,
    });
    expect(fixture.read('saleRoundItems/item-1')).toMatchObject({
      reservedQuantity: 0,
      orderedQuantity: 2,
    });
    expect(fixture.read('payments/order-1')).toMatchObject({
      status: 'PAID',
      amount: 40_000,
    });
  });

  it('회차 취소는 실제 주문 취소 서비스로 환불·예약 반환·카운터를 멱등 정리한다', async () => {
    const fixture = makeFixture();
    await fixture.finalization.finalizePaidOrder('order-1', {
      amount: { total: 40_000 },
      status: 'PAID',
      method: { type: 'CARD' },
      transactionId: 'transaction-1',
    } as never);

    await fixture.roundState.cancel({
      storeId: 'store-1',
      roundId: 'round-1',
      expectedStatus: 'OPEN',
      reason: '판매 회차 취소',
    });
    await fixture.roundState.cancel({
      storeId: 'store-1',
      roundId: 'round-1',
      expectedStatus: 'CANCELLED',
      reason: '판매 회차 취소',
    });

    expect(fixture.payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(fixture.read('orders/order-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
    });
    expect(fixture.read('checkoutReservations/reservation-1')).toMatchObject({
      status: 'RELEASED',
    });
    expect(fixture.read('saleRounds/round-1')).toMatchObject({
      status: 'CANCELLED',
      cancellation: { status: 'COMPLETED' },
      counters: {
        reservedDeliveryAddresses: 0,
        reservedItemQuantity: 0,
        orderedDeliveryAddresses: 0,
        orderedItemQuantity: 0,
        heldOrderCount: 0,
      },
    });
  });

  it('소비자·판매자·기사는 실제 주문 관계가 없으면 상세 조회할 수 없다', async () => {
    const fixture = makeFixture({
      'orders/order-1': {
        ...baseRecords()['orders/order-1'],
        driverId: 'driver-1',
        deliveryPhone: '01000000000',
      },
    });

    await expect(
      fixture.queries.getOrderById('order-1', { sub: 'consumer-2', role: 'consumer' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      fixture.queries.getOrderById('order-1', { sub: 'seller-2', role: 'seller' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      fixture.queries.getOrderById('order-1', { sub: 'driver-2', role: 'driver' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      fixture.queries.getOrderById('order-1', { sub: 'consumer-1', role: 'consumer' }),
    ).resolves.toMatchObject({ id: 'order-1', userId: 'consumer-1' });
  });

  it('용량 마감 회차는 한도 반환 뒤 마감 전이면 다시 열린다', async () => {
    const fixture = makeFixture({
      'saleRounds/round-1': {
        ...baseRecords()['saleRounds/round-1'],
        status: 'CLOSED',
        closeReason: 'CAPACITY',
        counters: {
          reservedDeliveryAddresses: 0,
          reservedItemQuantity: 0,
          orderedDeliveryAddresses: 14,
          orderedItemQuantity: 29,
          heldOrderCount: 0,
        },
      },
    });

    await expect(fixture.roundState.refreshStatus('store-1', 'round-1')).resolves.toMatchObject({
      status: 'OPEN',
      closeReason: null,
    });
    expect(fixture.read('saleRounds/round-1')).toMatchObject({
      status: 'OPEN',
      closeReason: null,
    });
  });
});
