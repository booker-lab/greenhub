// 취소 진행 중 주문의 배송 전이 차단, 로컬 취소의 현재 상태 재확인,
// 취소 시 배송 보류·재배송비 정리, 재배송비 금액 경계를 검증한다.

import { DRIVER_ORDER_STATE_CONFLICT } from '@greenhub/shared';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { DriverOrderScopeService } from './driver-order-scope.service';
import { HoldDeliveryDto, MAX_REDELIVERY_FEE_KRW } from './dto/update-status.dto';
import { RoundOrderLifecycleService } from './round-order-lifecycle.service';

type Occ = ReturnType<typeof createOccFirestore>;

const ORDER_ID = 'order-1';
const ORDER_PATH = `orders/${ORDER_ID}`;
const PAYMENT_PATH = `payments/${ORDER_ID}`;

function makeService(occ: Occ, onRefund?: () => void) {
  const payments = {
    processRefundByOrderId: jest.fn(async () => {
      occ.updateOutsideTransaction(PAYMENT_PATH, { refundedAt: '2026-10-01T00:00:00.000Z' });
      onRefund?.();
    }),
    refundOrderChargesByOrderId: jest.fn().mockResolvedValue(undefined),
  };
  const settlements = { cancelSettlement: jest.fn().mockResolvedValue(undefined) };
  const capacity = {
    releaseForOrderCancellationInTransaction: jest.fn().mockResolvedValue({}),
    adjustHeldOrderCountInTransaction: jest.fn().mockResolvedValue({}),
  };
  const service = new RoundOrderLifecycleService(
    occ.firestore as never,
    payments as never,
    settlements as never,
    capacity as never,
  );
  return { service, payments, settlements, capacity };
}

function seedOrder(occ: Occ, order: Record<string, unknown>, paid = false) {
  occ.seed(ORDER_PATH, {
    id: ORDER_ID,
    storeId: 'store-1',
    userId: 'user-1',
    schemaVersion: 2,
    roundId: 'round-1',
    deliveryMethod: 'direct',
    ...order,
  });
  if (paid) {
    occ.seed(PAYMENT_PATH, { id: ORDER_ID, orderId: ORDER_ID, status: 'PAID' });
  }
}

const paidRedeliveryHold = {
  heldAt: '2026-10-01T00:00:00.000Z',
  reasonCode: 'CUSTOMER_UNREACHABLE',
  reasonMessage: '부재',
  customerResponsible: true,
  redeliveryFee: 3000,
  nextContactAt: null,
  nextDeliveryAt: null,
  resolvedAt: null,
};

describe('취소 진행 중 주문의 상태 전이 차단', () => {
  it.each([
    'REFUNDING',
    'LOCAL_PENDING',
    'LOCAL_FAILED',
    'REFUND_FAILED',
  ])('취소 상태 %s인 주문은 판매자 상태 변경을 거부하고 주문을 그대로 둔다', async (cancellationStatus) => {
    const occ = createOccFirestore();
    seedOrder(occ, {
      status: 'PREPARING',
      cancellation: { status: cancellationStatus, reason: '판매자 취소' },
    });
    const { service } = makeService(occ);

    await expect(
      service.updateStatus({
        storeId: 'store-1',
        orderId: ORDER_ID,
        expectedStatus: 'PREPARING',
        dto: { status: 'DELIVERED' },
        requesterId: 'seller-1',
        requesterRole: 'seller',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(occ.getData(ORDER_PATH)).toMatchObject({ status: 'PREPARING' });
  });

  it('기사 배송 완료도 같은 409 상태 충돌 코드로 거부한다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, {
      status: 'DELIVERING',
      driverId: 'driver-1',
      deliveryPhotoIds: ['photo-1'],
      cancellation: { status: 'REFUNDING', reason: '회차 취소' },
    });
    const { service } = makeService(occ);

    const error = await service
      .updateStatus({
        storeId: 'store-1',
        orderId: ORDER_ID,
        expectedStatus: 'DELIVERING',
        dto: { status: 'DELIVERED' },
        requesterId: 'driver-1',
        requesterRole: 'driver',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: DRIVER_ORDER_STATE_CONFLICT,
    });
    expect(occ.getData(ORDER_PATH)).toMatchObject({ status: 'DELIVERING' });
  });

  describe('기사 범위 검증(사진 연결·legacy 기사 전이 공통)', () => {
    function makeScope(order: Record<string, unknown>) {
      const occ = createOccFirestore();
      occ.seed('stores/store-1', { id: 'store-1', salesMode: 'legacy' });
      return {
        scope: new DriverOrderScopeService(occ.firestore as never),
        input: {
          requesterId: 'driver-1',
          requesterRole: 'driver',
          storeId: 'store-1',
          order: { storeId: 'store-1', deliveryMethod: 'direct', ...order },
          expectedStatus: String(order['status']),
          nextStatus: order['status'] === 'PREPARING' ? 'DELIVERING' : 'DELIVERED',
        },
        occ,
      };
    }

    it('취소 진행 중 배정 주문의 배송 완료를 사전 검증에서 403으로 거부한다', async () => {
      const { scope, input } = makeScope({
        status: 'DELIVERING',
        driverId: 'driver-1',
        cancellation: { status: 'LOCAL_PENDING' },
      });

      const error = await scope.assertMutationEligibility(input).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: DRIVER_ORDER_STATE_CONFLICT,
      });
    });

    it('취소 진행 중 미배정 주문의 first claim을 트랜잭션 안에서 409로 거부한다', async () => {
      const { scope, input, occ } = makeScope({
        status: 'PREPARING',
        driverId: null,
        cancellation: { status: 'REFUNDING' },
      });

      await expect(
        occ.firestore.runTransaction((tx: never) =>
          scope.assertFirstClaimEligibilityInTransaction(tx, input),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('취소가 완료되지 않은 기록이 없으면 기존처럼 허용한다', async () => {
      const { scope, input } = makeScope({
        status: 'DELIVERING',
        driverId: 'driver-1',
        cancellation: null,
      });

      await expect(scope.assertMutationEligibility(input)).resolves.toBe('legacy');
    });
  });
});

describe('로컬 취소의 현재 상태 재확인', () => {
  it('환불 중 주문 상태가 취소 불가 상태로 바뀌면 CANCELLED로 덮어쓰지 않고 LOCAL_FAILED로 남긴다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, { status: 'PREPARING' }, true);
    const { service, capacity, settlements } = makeService(occ, () => {
      occ.updateOutsideTransaction(ORDER_PATH, { status: 'DELIVERED' });
    });

    await expect(
      service.cancelForRound({
        storeId: 'store-1',
        orderId: ORDER_ID,
        expectedStatus: 'PREPARING',
        reason: '회차 취소',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'DELIVERED',
      cancellation: { status: 'LOCAL_FAILED' },
    });
    expect(capacity.releaseForOrderCancellationInTransaction).not.toHaveBeenCalled();
    expect(settlements.cancelSettlement).not.toHaveBeenCalled();
  });
});

describe('취소 시 배송 보류·재배송비 정리', () => {
  it('보류 중 주문을 취소하면 보류를 해제해 재배송비 결제 요청이 남지 않는다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, { status: 'DELIVERY_HELD', deliveryHold: paidRedeliveryHold }, true);
    const { service, capacity } = makeService(occ);

    await service.cancelForRound({
      storeId: 'store-1',
      orderId: ORDER_ID,
      expectedStatus: 'DELIVERY_HELD',
      reason: '회차 취소',
    });

    const order = occ.getData(ORDER_PATH)!;
    expect(order).toMatchObject({ status: 'CANCELLED', cancellation: { status: 'COMPLETED' } });
    expect(order['deliveryHold']).toMatchObject({
      ...paidRedeliveryHold,
      resolvedAt: expect.any(String),
    });
    expect(capacity.releaseForOrderCancellationInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ decrementHeld: true }),
    );
  });

  it('재배송비 결제를 기다리는 PREPARING 주문도 보류 집계에서 빠지고 보류가 해제된다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, { status: 'PREPARING', deliveryHold: paidRedeliveryHold }, true);
    const { service, capacity } = makeService(occ);

    await service.cancelForRound({
      storeId: 'store-1',
      orderId: ORDER_ID,
      expectedStatus: 'PREPARING',
      reason: '회차 취소',
    });

    expect(capacity.releaseForOrderCancellationInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ decrementHeld: true, roundId: 'round-1' }),
    );
    expect(occ.getData(ORDER_PATH)!['deliveryHold']).toMatchObject({
      resolvedAt: expect.any(String),
    });
  });

  it('해제된 보류가 있는 PREPARING 주문은 보류 집계를 다시 빼지 않는다', async () => {
    const occ = createOccFirestore();
    const resolvedHold = { ...paidRedeliveryHold, resolvedAt: '2026-10-02T00:00:00.000Z' };
    seedOrder(occ, { status: 'PREPARING', deliveryHold: resolvedHold }, true);
    const { service, capacity } = makeService(occ);

    await service.cancelForRound({
      storeId: 'store-1',
      orderId: ORDER_ID,
      expectedStatus: 'PREPARING',
      reason: '회차 취소',
    });

    expect(capacity.releaseForOrderCancellationInTransaction).not.toHaveBeenCalled();
    expect(occ.getData(ORDER_PATH)!['deliveryHold']).toEqual(resolvedHold);
  });
});

describe('재배송비 금액 경계', () => {
  async function validateFee(redeliveryFee: unknown) {
    const dto = plainToInstance(HoldDeliveryDto, {
      deliveryHold: {
        reasonCode: 'CUSTOMER_UNREACHABLE',
        reasonMessage: '부재',
        customerResponsible: true,
        redeliveryFee,
      },
    });
    return validate(dto);
  }

  it.each([0, 3000, MAX_REDELIVERY_FEE_KRW, null])('%p원은 허용한다', async (fee) => {
    expect(await validateFee(fee)).toHaveLength(0);
  });

  it.each([
    1500.5,
    -1000,
    MAX_REDELIVERY_FEE_KRW + 1,
    990000,
    '3000',
  ])('%p는 정수 상한 검증에서 거부한다', async (fee) => {
    expect((await validateFee(fee)).length).toBeGreaterThan(0);
  });

  it('DTO를 거치지 않은 보류 요청도 서비스에서 상한을 다시 확인한다', async () => {
    const occ = createOccFirestore();
    seedOrder(occ, { status: 'DELIVERING' });
    const { service } = makeService(occ);

    await expect(
      service.updateStatus({
        storeId: 'store-1',
        orderId: ORDER_ID,
        expectedStatus: 'DELIVERING',
        dto: {
          status: 'DELIVERY_HELD',
          deliveryHold: {
            reasonCode: 'CUSTOMER_UNREACHABLE',
            reasonMessage: '부재',
            customerResponsible: true,
            redeliveryFee: MAX_REDELIVERY_FEE_KRW + 1,
          },
        },
        requesterId: 'seller-1',
        requesterRole: 'seller',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(occ.getData(ORDER_PATH)).toMatchObject({ status: 'DELIVERING' });
  });
});
