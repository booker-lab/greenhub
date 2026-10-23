// 배송 후 환불(판매자 7일·관리자 무기한) 서비스 회귀 — 계획서 post-delivery-refund-plan.md R4.
// 가짜 Firestore(OCC 하네스)로 실제 PostDeliveryRefundService를 구동한다. PortOne·알림은 mock.

import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { REFUND_NOTICE_REASONS } from '../notifications/refund-notice-reasons';
import { PostDeliveryRefundService } from './post-delivery-refund.service';

type Occ = ReturnType<typeof createOccFirestore>;

const ORDER_ID = 'order-1';
const ORDER_PATH = `orders/${ORDER_ID}`;
const PAYMENT_PATH = `payments/${ORDER_ID}`;
const SETTLEMENT_PATH = `settlements/${ORDER_ID}`;
const DAY_MS = 24 * 60 * 60 * 1000;

function makeService(occ: Occ, options: { refundFails?: boolean } = {}) {
  let refundFails = options.refundFails ?? false;
  const payments = {
    processRefundByOrderId: jest.fn(async () => {
      if (refundFails) throw new Error('PortOne 응답 없음');
      occ.updateOutsideTransaction(PAYMENT_PATH, {
        status: 'CANCELLED',
        refundedAt: new Date().toISOString(),
      });
    }),
    refundOrderChargesByOrderId: jest.fn().mockResolvedValue(undefined),
  };
  const settlements = { cancelSettlement: jest.fn().mockResolvedValue(undefined) };
  const notifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
  const service = new PostDeliveryRefundService(
    occ.firestore as never,
    payments as never,
    settlements as never,
    notifications as never,
  );
  return {
    service,
    payments,
    settlements,
    notifications,
    setRefundFails: (value: boolean) => {
      refundFails = value;
    },
  };
}

function seed(
  occ: Occ,
  options: {
    status?: string;
    deliveredDaysAgo?: number | null;
    settlementStatus?: string;
    schemaVersion?: number;
    paymentStatus?: string;
  } = {},
) {
  occ.seed(ORDER_PATH, {
    id: ORDER_ID,
    orderNumber: '20261101-000001',
    storeId: 'store-1',
    userId: 'user-1',
    schemaVersion: options.schemaVersion ?? 2,
    roundId: 'round-1',
    status: options.status ?? 'DELIVERED',
    totalAmount: 30000,
  });
  occ.seed(PAYMENT_PATH, {
    id: ORDER_ID,
    orderId: ORDER_ID,
    storeId: 'store-1',
    userId: 'user-1',
    status: options.paymentStatus ?? 'PAID',
    amount: 30000,
    portonePaymentId: 'pay-1',
  });
  const daysAgo = options.deliveredDaysAgo === undefined ? 3 : options.deliveredDaysAgo;
  if (daysAgo !== null) {
    occ.seed(SETTLEMENT_PATH, {
      id: ORDER_ID,
      orderId: ORDER_ID,
      storeId: 'store-1',
      status: options.settlementStatus ?? 'pending',
      netAmount: 28500,
      settledAt: new Date(Date.now() - daysAgo * DAY_MS),
    });
  }
}

const sellerInput = {
  storeId: 'store-1',
  orderId: ORDER_ID,
  actorRole: 'seller' as const,
  actorId: 'seller-1',
  reasonCode: 'QUALITY_DAMAGED' as const,
  memo: '받은 날 꽃잎이 시들었다고 사진과 함께 연락 옴',
};

describe('PostDeliveryRefundService', () => {
  it('판매자가 배송 완료 3일째 주문을 환불하면 결제·주문·정산·알림이 함께 맞춰진다', async () => {
    const occ = createOccFirestore();
    seed(occ);
    const { service, payments, settlements, notifications } = makeService(occ);

    await expect(service.refund(sellerInput)).resolves.toEqual({
      orderId: ORDER_ID,
      status: 'CANCELLED',
    });

    expect(payments.processRefundByOrderId).toHaveBeenCalledWith(
      ORDER_ID,
      '배송 후 환불(꽃 상함)',
      { verifyProviderFirst: true },
    );
    expect(payments.refundOrderChargesByOrderId).toHaveBeenCalledWith(
      ORDER_ID,
      '배송 후 환불(꽃 상함)',
    );
    expect(settlements.cancelSettlement).toHaveBeenCalledWith(ORDER_ID);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CANCELLED',
      cancelReason: '배송 후 환불(꽃 상함)',
      cancellation: { status: 'COMPLETED' },
      postDeliveryRefund: {
        reasonCode: 'QUALITY_DAMAGED',
        memo: sellerInput.memo,
        actorRole: 'seller',
        actorId: 'seller-1',
        previousStatus: 'DELIVERED',
        amount: 30000,
        completedAt: expect.any(String),
      },
    });
    expect(notifications.sendToUser).toHaveBeenCalledWith(
      'user-1',
      'ORDER_CANCELLED',
      {
        orderId: expect.any(String),
        reason: REFUND_NOTICE_REASONS.POST_DELIVERY_QUALITY_DAMAGED,
      },
      ORDER_ID,
      `refund-notice:POST_DELIVERY_QUALITY_DAMAGED:${ORDER_ID}`,
    );
  });

  it.each([
    ['배송 완료 8일째', { deliveredDaysAgo: 8 }, '7일이 지나'],
    ['정산금이 이미 지급됨', { settlementStatus: 'paid' }, '이미 정산금이 지급된'],
    ['정산 기록이 없음', { deliveredDaysAgo: null }, '정산 기록을 확인할 수 없어'],
    ['아직 배송 전(PREPARING)', { status: 'PREPARING' }, '배송이 완료된 주문만'],
  ])('판매자는 %s 주문을 환불할 수 없고 결제·주문은 그대로다', async (_label, options, message) => {
    const occ = createOccFirestore();
    seed(occ, options);
    const before = occ.getData(ORDER_PATH);
    const { service, payments, notifications } = makeService(occ);

    await expect(service.refund(sellerInput)).rejects.toThrow(message);

    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(notifications.sendToUser).not.toHaveBeenCalled();
    expect(occ.getData(ORDER_PATH)).toEqual(before);
  });

  it('회차 주문이 아니면 400으로 거부한다', async () => {
    const occ = createOccFirestore();
    seed(occ, { schemaVersion: 1 });
    const { service, payments } = makeService(occ);

    await expect(service.refund(sellerInput)).rejects.toThrow('회차 주문만');
    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
  });

  it('다른 매장 주문은 찾을 수 없다고 답한다', async () => {
    const occ = createOccFirestore();
    seed(occ);
    const { service } = makeService(occ);

    await expect(service.refund({ ...sellerInput, storeId: 'store-2' })).rejects.toThrow(
      'Not Found',
    );
  });

  it('메모가 비어 있으면 거부한다', async () => {
    const occ = createOccFirestore();
    seed(occ);
    const { service, payments } = makeService(occ);

    await expect(service.refund({ ...sellerInput, memo: '   ' })).rejects.toThrow('메모');
    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
  });

  it('같은 요청을 두 번 보내도 환불은 한 번만 하고 두 번째는 완료 상태를 그대로 돌려준다', async () => {
    const occ = createOccFirestore();
    seed(occ);
    const { service, payments, notifications } = makeService(occ);

    await service.refund(sellerInput);
    await expect(service.refund(sellerInput)).resolves.toEqual({
      orderId: ORDER_ID,
      status: 'CANCELLED',
    });

    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    // 알림은 같은 멱등 키로만 다시 요청된다(알림 서비스가 중복 발송을 막는다).
    const keys = notifications.sendToUser.mock.calls.map((call) => call[4]);
    expect(new Set(keys).size).toBe(1);
  });

  it('환불이 실패하면 REFUND_FAILED로 남고, 기간이 지난 뒤 다시 보내도 처음 기록으로 이어서 끝낸다', async () => {
    const occ = createOccFirestore();
    seed(occ, { deliveredDaysAgo: 6.9 });
    const { service, payments, setRefundFails } = makeService(occ, { refundFails: true });

    await expect(service.refund(sellerInput)).rejects.toThrow('PortOne 응답 없음');
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'DELIVERED',
      cancellation: { status: 'REFUND_FAILED' },
      postDeliveryRefund: { reasonCode: 'QUALITY_DAMAGED', completedAt: null },
    });

    // 그사이 7일이 지났다(정산 settledAt을 8일 전으로 옮긴다).
    occ.updateOutsideTransaction(SETTLEMENT_PATH, {
      settledAt: new Date(Date.now() - 8 * DAY_MS),
    });
    setRefundFails(false);
    await expect(
      service.refund({ ...sellerInput, reasonCode: 'OTHER', memo: '재시도' }),
    ).resolves.toEqual({ orderId: ORDER_ID, status: 'CANCELLED' });

    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(2);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      status: 'CANCELLED',
      postDeliveryRefund: { reasonCode: 'QUALITY_DAMAGED', memo: sellerInput.memo },
    });
  });

  it('관리자는 배송 완료 10일째·정산 지급 완료 주문도 환불할 수 있다', async () => {
    const occ = createOccFirestore();
    seed(occ, { deliveredDaysAgo: 10, settlementStatus: 'paid' });
    const { service, payments, settlements } = makeService(occ);

    await expect(
      service.refund({ ...sellerInput, actorRole: 'admin', actorId: 'admin-1' }),
    ).resolves.toEqual({ orderId: ORDER_ID, status: 'CANCELLED' });

    expect(payments.processRefundByOrderId).toHaveBeenCalledTimes(1);
    expect(settlements.cancelSettlement).toHaveBeenCalledWith(ORDER_ID);
    expect(occ.getData(ORDER_PATH)).toMatchObject({
      postDeliveryRefund: { actorRole: 'admin', actorId: 'admin-1' },
    });
  });

  it('이미 다른 경로로 취소된 주문은 다시 환불하지 않는다', async () => {
    const occ = createOccFirestore();
    seed(occ, { status: 'CANCELLED' });
    const { service, payments } = makeService(occ);

    await expect(service.refund(sellerInput)).rejects.toThrow('이미 취소된 주문');
    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
  });

  describe('getSellerEligibility', () => {
    it('3일째 주문은 환불 가능하고 마감 시각과 금액을 알려 준다', async () => {
      const occ = createOccFirestore();
      seed(occ);
      const { service } = makeService(occ);

      const result = await service.getSellerEligibility('store-1', ORDER_ID);

      expect(result).toMatchObject({ eligible: true, reason: 'OK', amount: 30000 });
      const settledAt = occ.getData(SETTLEMENT_PATH)?.['settledAt'] as Date;
      expect(result.deadline).toBe(new Date(settledAt.getTime() + 7 * DAY_MS).toISOString());
    });

    it.each([
      [{ deliveredDaysAgo: 8 }, 'WINDOW_EXPIRED'],
      [{ settlementStatus: 'paid' }, 'SETTLEMENT_PAID'],
      [{ status: 'PREPARING' }, 'NOT_DELIVERED'],
      [{ status: 'CANCELLED' }, 'ALREADY_REFUNDED'],
    ])('%o 이면 %s', async (options, reason) => {
      const occ = createOccFirestore();
      seed(occ, options);
      const { service } = makeService(occ);

      await expect(service.getSellerEligibility('store-1', ORDER_ID)).resolves.toMatchObject({
        eligible: false,
        reason,
      });
    });
  });
});
