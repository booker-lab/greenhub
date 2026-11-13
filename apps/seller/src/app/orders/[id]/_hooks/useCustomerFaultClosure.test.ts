import { describe, expect, it, vi } from 'vitest';
import {
  buildCustomerFaultClosurePath,
  buildCustomerFaultClosureRequest,
  buildSettlementReconcileRequest,
  loadCustomerFaultClosureEligibility,
} from './useCustomerFaultClosure';

// vi.mock은 import보다 먼저 적용된다. vitest에는 '@/' 별칭 설정이 없어 lib/api를 대신한다.
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));
vi.mock('@/lib/api', () => ({ apiJson: vi.fn() }));

describe('고객 사유 종결 요청', () => {
  it('매장·주문 id로 경로를 만들고, 경로 조각 형식이 아니면 요청 전에 거절한다', () => {
    expect(buildCustomerFaultClosurePath('store-1', 'order-1')).toBe(
      '/stores/store-1/orders/order-1/customer-fault-closure',
    );
    expect(() => buildCustomerFaultClosurePath('store-1', 'order/1')).toThrow();
  });

  it('메모만 POST 본문으로 보낸다(앞뒤 공백 제거)', () => {
    const init = buildCustomerFaultClosureRequest('  11/14 통화  ');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ memo: '11/14 통화' });
  });

  it('정산 다시 맞추기는 같은 종결 POST를 고정 메모로 보낸다(이미 종결한 주문은 정산만 맞춘다)', () => {
    const init = buildSettlementReconcileRequest();
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ memo: '정산 다시 맞추기' });
  });

  it('판정을 읽고, 요청 실패나 잘못된 응답이면 null로 닫는다', async () => {
    const ok = vi.fn().mockResolvedValue({
      eligible: true,
      reason: 'OK',
      closureReasonCode: 'RECEIPT_REFUSED',
      eligibleAt: '2026-11-13T06:00:00.000Z',
      paymentDeadlineDate: '2026-11-16',
      redeliveryFee: 5000,
    });
    await expect(loadCustomerFaultClosureEligibility('/p', ok)).resolves.toMatchObject({
      eligible: true,
      reason: 'OK',
    });
    expect(ok).toHaveBeenCalledWith('/p');

    await expect(
      loadCustomerFaultClosureEligibility('/p', vi.fn().mockRejectedValue(new Error('500'))),
    ).resolves.toBeNull();
    await expect(
      loadCustomerFaultClosureEligibility('/p', vi.fn().mockResolvedValue({ eligible: true })),
    ).resolves.toBeNull();
  });
});
