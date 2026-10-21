// 관리자 배송 후 환불 회귀 — 계획서 R5.
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import { AdminPostDeliveryRefundService } from './admin-post-delivery-refund.service';

const NO_RECOVERY = { recoveryRequired: false, recoveryAmount: 0 };

function makeService(occ: ReturnType<typeof createOccFirestore>) {
  const refunds = {
    refund: jest
      .fn()
      .mockResolvedValue({ orderId: 'order-1', status: 'CANCELLED', ...NO_RECOVERY }),
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
      ...NO_RECOVERY,
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

  it('지급 완료 정산이면 응답과 행동 기록에 판매자 회수 금액이 실린다', async () => {
    const occ = createOccFirestore();
    occ.seed('orders/order-1', { storeId: 'store-1', status: 'DELIVERED' });
    const { service, refunds, audit } = makeService(occ);
    refunds.refund.mockResolvedValueOnce({
      orderId: 'order-1',
      status: 'CANCELLED',
      recoveryRequired: true,
      recoveryAmount: 28500,
    });

    await expect(service.refund('order-1', dto, 'admin-1')).resolves.toMatchObject({
      recoveryRequired: true,
      recoveryAmount: 28500,
    });
    expect(audit.logAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        after: {
          status: 'CANCELLED',
          reasonCode: 'BROKEN',
          recoveryRequired: true,
          recoveryAmount: 28500,
        },
      }),
    );
  });

  it('환불이 실패하면 행동 기록을 남기지 않는다', async () => {
    const occ = createOccFirestore();
    occ.seed('orders/order-1', { storeId: 'store-1', status: 'DELIVERED' });
    const { service, refunds, audit } = makeService(occ);
    refunds.refund.mockRejectedValueOnce(new Error('PortOne 실패'));

    await expect(service.refund('order-1', dto, 'admin-1')).rejects.toThrow('PortOne 실패');
    expect(audit.logAdmin).not.toHaveBeenCalled();
  });

  it('행동 기록이 실패해도 끝난 환불 결과를 돌려준다', async () => {
    const occ = createOccFirestore();
    occ.seed('orders/order-1', { storeId: 'store-1', status: 'DELIVERED' });
    const { service, audit } = makeService(occ);
    audit.logAdmin.mockRejectedValueOnce(new Error('기록 실패'));

    await expect(service.refund('order-1', dto, 'admin-1')).resolves.toMatchObject({
      status: 'CANCELLED',
    });
  });

  it('없는 주문은 404', async () => {
    const occ = createOccFirestore();
    const { service, refunds } = makeService(occ);

    await expect(service.refund('order-x', dto, 'admin-1')).rejects.toThrow(
      '주문을 찾을 수 없습니다',
    );
    expect(refunds.refund).not.toHaveBeenCalled();
  });
});
