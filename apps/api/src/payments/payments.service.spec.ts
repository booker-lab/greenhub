import { PaymentsService } from './payments.service';

function createService() {
  const updates: Array<{ path: string; data: Record<string, unknown> }> = [];
  const firestore = {
    doc: jest.fn((path: string) => ({
      update: jest.fn((data: Record<string, unknown>) => {
        updates.push({ path, data });
        return Promise.resolve();
      }),
    })),
    FieldValue: {
      increment: jest.fn((value: number) => ({ increment: value })),
    },
    Timestamp: {
      now: jest.fn(() => 'now'),
    },
  };
  const service = new PaymentsService(firestore as never, {} as never, {} as never, {} as never);
  return { service, firestore, updates };
}

describe('PaymentsService', () => {
  it('일반 비택배 주문 취소 보상은 requestedDeliveryDate dailyCaps만 되돌린다', async () => {
    const { service, firestore, updates } = createService();

    await (
      service as unknown as {
        cancelOrderWithSlotRecovery: (
          orderId: string,
          order: Record<string, unknown>,
          reason: string,
        ) => Promise<void>;
      }
    ).cancelOrderWithSlotRecovery(
      'order-1',
      {
        storeId: 'store-1',
        saleType: 'normal',
        deliveryMethod: 'hub',
        requestedDeliveryDate: '2026-06-10',
        quantity: 2,
      },
      'payment_failed',
    );

    expect(updates).toEqual([
      {
        path: 'orders/order-1',
        data: { status: 'CANCELLED', cancelReason: 'payment_failed', updatedAt: 'now' },
      },
      {
        path: 'dailyCaps/store-1_2026-06-10',
        data: { usedSlots: { increment: -2 } },
      },
    ]);
    expect(firestore.FieldValue.increment).toHaveBeenCalledWith(-2);
  });

  it('공동구매 주문 취소 보상은 dailyCaps를 되돌리지 않는다', async () => {
    const { service, updates } = createService();

    await (
      service as unknown as {
        cancelOrderWithSlotRecovery: (
          orderId: string,
          order: Record<string, unknown>,
          reason: string,
        ) => Promise<void>;
      }
    ).cancelOrderWithSlotRecovery(
      'order-1',
      {
        storeId: 'store-1',
        saleType: 'group',
        deliveryMethod: 'hub',
        quantity: 2,
      },
      'payment_failed',
    );

    expect(updates).toEqual([
      {
        path: 'orders/order-1',
        data: { status: 'CANCELLED', cancelReason: 'payment_failed', updatedAt: 'now' },
      },
    ]);
  });
});
