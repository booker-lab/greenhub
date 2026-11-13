// 고객 사유 종결 상태(CLOSED_UNDELIVERED)는 전용 API만 만든다. 일반 상태 변경(PATCH status)은
// 어느 역할·어느 상태에서도 이 상태로 가거나 이 상태에서 나갈 수 없다.

import { ForbiddenException } from '@nestjs/common';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { createSettledOrdersLifecycle } from '../../test/helpers/settled-orders-lifecycle';
import { ORDER_STATUSES } from './dto/update-status.dto';
import { getAllowedTransitions } from './orders.helpers';

const ROLES = ['seller', 'admin', 'driver', 'consumer'] as const;

describe('CLOSED_UNDELIVERED 상태 전이 차단', () => {
  it('역할별 전이표 어디에도 CLOSED_UNDELIVERED로 가는 전이가 없다', () => {
    for (const role of ROLES) {
      for (const status of ORDER_STATUSES) {
        expect(getAllowedTransitions(role, status)).not.toContain('CLOSED_UNDELIVERED');
      }
    }
  });

  it('CLOSED_UNDELIVERED에서 나가는 전이도 없다', () => {
    for (const role of ROLES) {
      expect(getAllowedTransitions(role, 'CLOSED_UNDELIVERED')).toEqual([]);
    }
  });

  function makeLifecycle(order: Record<string, unknown>) {
    const occ = createOccFirestore();
    occ.seed('orders/order-1', {
      id: 'order-1',
      storeId: 'store-1',
      userId: 'user-1',
      schemaVersion: 2,
      roundId: 'round-1',
      deliveryMethod: 'direct',
      ...order,
    });
    occ.seed('stores/store-1', { ownerId: 'seller-1' });
    const roundLifecycle = { updateStatus: jest.fn(), cancel: jest.fn() };
    const lifecycle = createSettledOrdersLifecycle(
      occ.firestore as never,
      { sendToUser: jest.fn() } as never,
      {} as never,
      { createSettlement: jest.fn() } as never,
      {} as never,
      roundLifecycle as never,
    );
    return { occ, lifecycle, roundLifecycle };
  }

  it.each([
    ['seller', 'seller-1'],
    ['admin', 'admin-1'],
  ])('%s가 보류 주문을 PATCH로 CLOSED_UNDELIVERED로 바꾸려 하면 거절한다', async (role, sub) => {
    const { occ, lifecycle, roundLifecycle } = makeLifecycle({
      status: 'DELIVERY_HELD',
      deliveryHold: {
        heldAt: '2026-11-13T06:00:00.000Z',
        reasonCode: 'RECEIPT_REFUSED',
        reasonMessage: '수령 거부',
        customerResponsible: true,
        redeliveryFee: 5000,
        resolvedAt: null,
      },
    });

    await expect(
      lifecycle.updateStatus('store-1', 'order-1', sub, { status: 'CLOSED_UNDELIVERED' }, role),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(roundLifecycle.updateStatus).not.toHaveBeenCalled();
    expect(occ.getData('orders/order-1')).toMatchObject({
      status: 'DELIVERY_HELD',
    });
  });

  it('종결된 주문을 PATCH로 다른 상태로 되돌릴 수 없다', async () => {
    const { occ, lifecycle, roundLifecycle } = makeLifecycle({
      status: 'CLOSED_UNDELIVERED',
    });

    for (const status of ['PREPARING', 'DELIVERING', 'CANCELLED', 'DELIVERED'] as const) {
      await expect(
        lifecycle.updateStatus('store-1', 'order-1', 'admin-1', { status }, 'admin'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(roundLifecycle.updateStatus).not.toHaveBeenCalled();
    expect(roundLifecycle.cancel).not.toHaveBeenCalled();
    expect(occ.getData('orders/order-1')).toMatchObject({
      status: 'CLOSED_UNDELIVERED',
    });
  });
});
