import { describe, expect, it } from 'vitest';
import { countHeldOrders, groupMapStops, isMapStop, mapStopAddressLine } from './map-stop-groups';

describe('groupMapStops', () => {
  it('배송 중 → 수거 대기 순서로 묶고 묶음 안 순서는 들어온 그대로다', () => {
    const route = [
      { id: 'p1', status: 'PREPARING' },
      { id: 'd1', status: 'DELIVERING' },
      { id: 'p2', status: 'PREPARING' },
      { id: 'd2', status: 'DELIVERING' },
    ];
    const groups = groupMapStops(route);
    expect(groups.map((group) => [group.label, group.orders.map((order) => order.id)])).toEqual([
      ['배송 중', ['d1', 'd2']],
      ['수거 대기', ['p1', 'p2']],
    ]);
  });

  it('주문이 없는 묶음은 빼고, 보류 주문은 묶음에 넣지 않는다', () => {
    const groups = groupMapStops([
      { id: 'p1', status: 'PREPARING' },
      { id: 'h1', status: 'DELIVERY_HELD' },
    ]);
    expect(groups).toEqual([
      { status: 'PREPARING', label: '수거 대기', orders: [{ id: 'p1', status: 'PREPARING' }] },
    ]);
    expect(groupMapStops([])).toEqual([]);
  });
});

describe('isMapStop·countHeldOrders', () => {
  it('지도 목록은 배송 중·수거 대기만 올리고 보류는 수만 센다', () => {
    const orders = [
      { status: 'PREPARING' },
      { status: 'DELIVERING' },
      { status: 'DELIVERY_HELD' },
      { status: 'DELIVERY_HELD' },
    ];
    expect(orders.filter(isMapStop)).toHaveLength(2);
    expect(countHeldOrders(orders)).toBe(2);
    expect(countHeldOrders([])).toBe(0);
  });
});

describe('mapStopAddressLine', () => {
  it('직배송은 동·호수를 앞에, 기본 주소를 뒤에 쓴다', () => {
    expect(
      mapStopAddressLine({
        deliveryMethod: 'direct',
        address: '경기도 이천시 중리천로 1 101동 1001호',
        deliveryAddress: { address: '경기도 이천시 중리천로 1' },
      }),
    ).toBe('101동 1001호 · 경기도 이천시 중리천로 1');
  });

  it('기본 주소가 없거나 맞지 않으면 전체 주소를 그대로 쓴다', () => {
    expect(mapStopAddressLine({ deliveryMethod: 'direct', address: '서울시 중구 1' })).toBe(
      '서울시 중구 1',
    );
    expect(
      mapStopAddressLine({
        deliveryMethod: 'direct',
        address: '서울시 중구 1',
        deliveryAddress: { address: '부산시' },
      }),
    ).toBe('서울시 중구 1');
    expect(mapStopAddressLine({ deliveryMethod: 'direct' })).toBe('-');
  });

  it('거점은 거점 이름을 앞에 쓴다', () => {
    expect(
      mapStopAddressLine({ deliveryMethod: 'hub', hubName: '이천 거점', hubAddress: '이천시 1' }),
    ).toBe('이천 거점 · 이천시 1');
    expect(mapStopAddressLine({ deliveryMethod: 'hub' })).toBe('거점 · -');
  });
});
