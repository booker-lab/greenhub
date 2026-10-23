import { describe, expect, it } from 'vitest';
import { describeActiveDeliveryWarning, readActiveDeliveryCount } from './useAdmin.driverSuspend';

describe('기사 정지 응답의 배송 중 주문 수', () => {
  it('정지 응답의 건수를 읽는다', () => {
    expect(readActiveDeliveryCount({ userId: 'd', suspended: true, activeDeliveryCount: 3 })).toBe(3);
  });

  it('서버가 세지 못했으면(null) 모름으로 읽는다', () => {
    expect(readActiveDeliveryCount({ suspended: true, activeDeliveryCount: null })).toBeNull();
  });

  it('필드가 없거나(정지 해제·옛 API) 형식이 틀리면 0으로 본다', () => {
    expect(readActiveDeliveryCount({ suspended: false })).toBe(0);
    expect(readActiveDeliveryCount(null)).toBe(0);
    expect(readActiveDeliveryCount({ activeDeliveryCount: '2' })).toBe(0);
    expect(readActiveDeliveryCount({ activeDeliveryCount: -1 })).toBe(0);
    expect(readActiveDeliveryCount({ activeDeliveryCount: 1.5 })).toBe(0);
  });

  it('건수가 있으면 배송 보류 경고, 0건이면 안내하지 않는다', () => {
    expect(describeActiveDeliveryWarning(2)).toBe(
      '배송 중인 주문 2건이 있어요 — 판매자가 배송 보류로 바꿔야 합니다.',
    );
    expect(describeActiveDeliveryWarning(0)).toBeNull();
    expect(describeActiveDeliveryWarning(null)).toContain('확인하지 못했어요');
  });
});
