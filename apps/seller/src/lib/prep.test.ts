import type { Order, Product } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import { aggregatePrep } from './prep';

const baseOrder: Order = {
  id: 'order-1',
  storeId: 'store-1',
  userId: 'user-1',
  productId: 'normal-1',
  quantity: 1,
  saleType: 'normal',
  status: 'ACCEPTED',
  deliveryMethod: 'direct',
  deliveryFee: 0,
  deliveryAddress: {
    address: '서울시 중구',
    addressDetail: '101호',
    zipCode: '04500',
  },
  isMetropolitan: true,
  hubId: null,
  pickupCode: null,
  totalAmount: 10000,
  requestedDeliveryDate: '2026-06-04',
  preparedAt: null,
  cancelReason: null,
  groupBuyConsent: null,
  createdAt: '2026-06-03T00:00:00.000Z',
  updatedAt: '2026-06-03T00:00:00.000Z',
};

const products: Product[] = [
  {
    id: 'normal-1',
    storeId: 'store-1',
    name: '일반 난',
    images: [],
    price: 10000,
    category: 'orchid',
    saleType: 'normal',
    deliverySize: 'small',
    isActive: true,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'group-1',
    storeId: 'store-1',
    name: '공구 난',
    images: [],
    price: 12000,
    category: 'orchid',
    saleType: 'group',
    deliverySize: 'small',
    isActive: true,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
];

describe('aggregatePrep', () => {
  it('일반 주문은 requestedDeliveryDate 기준으로 오늘 준비 물량에 포함한다', () => {
    const result = aggregatePrep([baseOrder], products, { today: '2026-06-04' });

    expect(result.today).toEqual([
      {
        productId: 'normal-1',
        productName: '일반 난',
        selectionLabel: null,
        quantity: 1,
      },
    ]);
    expect(result.delayed).toEqual([]);
  });

  it('공동구매 주문은 groupDeliveryDate 기준으로 집계한다', () => {
    const groupOrder: Order = {
      ...baseOrder,
      id: 'order-2',
      productId: 'group-1',
      quantity: 3,
      saleType: 'group',
      requestedDeliveryDate: null,
    };

    const result = aggregatePrep([groupOrder], products, {
      today: '2026-06-04',
      groupConfigMap: {
        'group-1': { groupDeliveryDate: '2026-06-04T00:00:00.000Z' },
      },
    });

    expect(result.today).toEqual([
      {
        productId: 'group-1',
        productName: '공구 난',
        selectionLabel: null,
        quantity: 3,
      },
    ]);
  });

  it('공동구매 배송일 설정이 없으면 준비 물량에서 제외한다', () => {
    const groupOrder: Order = {
      ...baseOrder,
      id: 'order-3',
      productId: 'group-1',
      saleType: 'group',
      requestedDeliveryDate: null,
    };

    const result = aggregatePrep([groupOrder], products, { today: '2026-06-04' });

    expect(result.today).toEqual([]);
    expect(result.delayed).toEqual([]);
  });
});
