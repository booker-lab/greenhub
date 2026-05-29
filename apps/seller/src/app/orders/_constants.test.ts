import type { Order } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import {
  canBulkPrepareOrder,
  canBulkShipParcelOrder,
  getBulkParcelShipEligibleIds,
  getBulkPrepareEligibleIds,
  getGroupConfigProductIds,
  getOrderAlertMeta,
  groupOrdersByDate,
  isOrderOverdue,
} from './_constants';

function isoOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function order(overrides: Partial<Order>): Order {
  return {
    id: overrides.id ?? 'order-1',
    storeId: 'store-1',
    userId: 'user-1',
    productId: overrides.productId ?? 'product-1',
    quantity: 1,
    saleType: overrides.saleType ?? 'normal',
    status: overrides.status ?? 'ACCEPTED',
    deliveryMethod: overrides.deliveryMethod ?? 'direct',
    deliveryFee: 0,
    deliveryAddress: { address: '서울', addressDetail: '1층', zipCode: '00000' },
    isMetropolitan: true,
    hubId: null,
    pickupCode: null,
    totalAmount: 10000,
    requestedDeliveryDate: overrides.requestedDeliveryDate ?? isoOffset(1),
    preparedAt: null,
    cancelReason: null,
    groupBuyConsent: null,
    createdAt: overrides.createdAt ?? isoOffset(-1),
    updatedAt: overrides.updatedAt ?? isoOffset(-1),
    ...overrides,
  };
}

describe('seller order priority alert', () => {
  it('처리 필요와 지연 주문 건수를 현재 판매 유형 기준으로 계산한다', () => {
    const orders = [
      order({ id: 'normal-action', status: 'ACCEPTED' }),
      order({ id: 'normal-overdue', status: 'PREPARING', requestedDeliveryDate: isoOffset(-2) }),
      order({ id: 'group-action', saleType: 'group', status: 'ACCEPTED' }),
    ];

    expect(getOrderAlertMeta(orders, 'normal')).toEqual({
      actionRequiredCount: 1,
      overdueCount: 1,
      overdueTab: 'WAITING',
    });
    expect(getOrderAlertMeta(orders, 'group')).toEqual({
      actionRequiredCount: 1,
      overdueCount: 0,
      overdueTab: null,
    });
  });

  it('지연 주문은 날짜 그룹에서 최상단 지연 그룹으로 분리된다', () => {
    const overdue = order({ id: 'overdue', requestedDeliveryDate: isoOffset(-1) });

    expect(isOrderOverdue(overdue, 'ACTION_REQUIRED')).toBe(true);
    expect(groupOrdersByDate([overdue], 'ACTION_REQUIRED')[0]?.dateKey).toBe('overdue');
  });

  it('공동구매 주문은 groupProductConfig 배송일로 지연 여부를 판단한다', () => {
    const groupOrder = order({
      id: 'group-overdue',
      saleType: 'group',
      status: 'ACCEPTED',
      requestedDeliveryDate: null,
      productId: 'group-product',
    });
    const groupConfigMap = {
      'group-product': { groupDeliveryDate: isoOffset(-1) },
    };

    expect(getOrderAlertMeta([groupOrder], 'group', groupConfigMap)).toEqual({
      actionRequiredCount: 1,
      overdueCount: 1,
      overdueTab: 'ACTION_REQUIRED',
    });
  });

  it('공동구매 배송일 조인은 현재 탭이 아닌 공구 전체 주문 productId를 대상으로 한다', () => {
    const orders = [
      order({ id: 'group-action', saleType: 'group', status: 'ACCEPTED', productId: 'group-a' }),
      order({ id: 'group-waiting', saleType: 'group', status: 'PREPARING', productId: 'group-b' }),
      order({ id: 'normal-action', saleType: 'normal', status: 'ACCEPTED', productId: 'normal-a' }),
    ];

    expect(getGroupConfigProductIds(orders, 'group')).toEqual(['group-a', 'group-b']);
    expect(getGroupConfigProductIds(orders, 'normal')).toEqual([]);
  });

  it('일괄 준비 대상은 결제 완료와 주문 확정 주문으로 제한한다', () => {
    const orders = [
      order({ id: 'accepted', status: 'ACCEPTED' }),
      order({ id: 'confirmed', status: 'CONFIRMED' }),
      order({ id: 'preparing', status: 'PREPARING' }),
      order({ id: 'delivering', status: 'DELIVERING' }),
    ];

    expect(orders.map(canBulkPrepareOrder)).toEqual([true, true, false, false]);
    expect(getBulkPrepareEligibleIds(orders)).toEqual(['accepted', 'confirmed']);
  });

  it('일괄 택배 발송 대상은 준비 중 택배 주문으로 제한한다', () => {
    const orders = [
      order({ id: 'parcel-preparing', status: 'PREPARING', deliveryMethod: 'parcel' }),
      order({ id: 'direct-preparing', status: 'PREPARING', deliveryMethod: 'direct' }),
      order({ id: 'parcel-accepted', status: 'ACCEPTED', deliveryMethod: 'parcel' }),
      order({ id: 'parcel-delivered', status: 'DELIVERED', deliveryMethod: 'parcel' }),
    ];

    expect(orders.map(canBulkShipParcelOrder)).toEqual([true, false, false, false]);
    expect(getBulkParcelShipEligibleIds(orders)).toEqual(['parcel-preparing']);
  });
});
