// 관리자 배송 후 환불·정산 회수 완료 회귀 — 계획서 R5.
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { AdminPostDeliveryRefundService } from './admin-post-delivery-refund.service';

function makeService(occ: ReturnType<typeof createOccFirestore>) {
  const refunds = {
    refund: jest.fn().mockResolvedValue({ orderId: 'order-1', status: 'CANCELLED' }),
  };
  const audit = { logAdmin: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminPostDeliveryRefundService(
    occ.firestore as never,
    refunds as never,
    audit as never,
  );
  return { service, refunds, audit };
}

const dto = { reasonCode: 'BROKEN' as const, memo: '10일째 연락, 화분 금 확인' };

describe('AdminPostDeliveryRefundService', () => {
  it('관리자 환불은 기간 조건 없이 admin 역할로 환불을 맡기고 행동 기록을 남긴다', async () => {
    const occ = createOccFirestore();
    occ.seed('orders/order-1', { storeId: 'store-1', status: 'REVIEWED' });
    const { service, refunds, audit } = makeService(occ);

    await expect(service.refund('order-1', dto, 'admin-1')).resolves.toEqual({
      orderId: 'order-1',
      status: 'CANCELLED',
    });

    expect(refunds.refund).toHaveBeenCalledWith({
      storeId: 'store-1',
      orderId: 'order-1',
      actorRole: 'admin',
      actorId: 'admin-1',
      reasonCode: 'BROKEN',
      memo: dto.memo,
    });
    expect(audit.logAdmin).toHaveBeenCalledWith({
      action: 'admin.order.post_delivery_refunded',
      actorId: 'admin-1',
      targetType: 'order',
      targetId: 'order-1',
      before: { status: 'REVIEWED' },
      after: { status: 'CANCELLED', reasonCode: 'BROKEN' },
      reason: dto.memo,
    });
  });

  it('환불이 실패하면 행동 기록을 남기지 않는다', async () => {
    const occ = createOccFirestore();
    occ.seed('orders/order-1', { storeId: 'store-1', status: 'DELIVERED' });
    const { service, refunds, audit } = makeService(occ);
    refunds.refund.mockRejectedValueOnce(new Error('PortOne 실패'));

    await expect(service.refund('order-1', dto, 'admin-1')).rejects.toThrow('PortOne 실패');
    expect(audit.logAdmin).not.toHaveBeenCalled();
  });

  it('없는 주문은 404', async () => {
    const occ = createOccFirestore();
    const { service, refunds } = makeService(occ);

    await expect(service.refund('order-x', dto, 'admin-1')).rejects.toThrow(
      '주문을 찾을 수 없습니다',
    );
    expect(refunds.refund).not.toHaveBeenCalled();
  });

  describe('completeRecovery', () => {
    it('회수 대기 정산을 회수 완료로 바꾸고 처리자·시각과 행동 기록을 같은 트랜잭션에 남긴다', async () => {
      const occ = createOccFirestore();
      occ.seed('settlements/order-1', {
        status: 'paid',
        recovery: {
          status: 'PENDING',
          amount: 28500,
          createdAt: new Date(),
          recoveredAt: null,
          recoveredBy: null,
        },
      });
      const { service, audit } = makeService(occ);

      await expect(service.completeRecovery('order-1', 'admin-1')).resolves.toEqual({
        settlementId: 'order-1',
        recoveryStatus: 'RECOVERED',
      });

      expect(occ.getData('settlements/order-1')).toMatchObject({
        status: 'paid',
        recovery: {
          status: 'RECOVERED',
          amount: 28500,
          recoveredBy: 'admin-1',
          recoveredAt: expect.any(Date),
        },
      });
      expect(audit.logAdmin).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.settlement.recovery_completed',
          targetType: 'settlement',
          targetId: 'order-1',
          after: { recoveryStatus: 'RECOVERED' },
        }),
        expect.anything(),
      );
    });

    it.each([
      [{ status: 'paid' }, '돌려받을 돈이 없는'],
      [{ status: 'paid', recovery: { status: 'RECOVERED', amount: 1 } }, '이미 회수 완료'],
    ])('%o 정산은 거부한다', async (settlement, message) => {
      const occ = createOccFirestore();
      occ.seed('settlements/order-1', settlement);
      const { service, audit } = makeService(occ);

      await expect(service.completeRecovery('order-1', 'admin-1')).rejects.toThrow(message);
      expect(audit.logAdmin).not.toHaveBeenCalled();
    });

    it('없는 정산은 404', async () => {
      const occ = createOccFirestore();
      const { service } = makeService(occ);
      await expect(service.completeRecovery('none', 'admin-1')).rejects.toThrow(
        '정산 내역을 찾을 수 없습니다',
      );
    });
  });
});
