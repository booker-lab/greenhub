import { describe, expect, it } from 'vitest';
import { inFlightPhotoOrderIds } from '../../../lib/delivering-groups';
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

describe('groupMapStops 사진 올리는 중', () => {
  it('완료 사진이 대기열에 있는 배송 중 주문은 "배송 중"에서 빼고 "사진 올리는 중"에 둔다(S-02)', () => {
    const groups = groupMapStops(
      [
        { id: 'd1', status: 'DELIVERING' },
        { id: 'p1', status: 'PREPARING' },
        { id: 'd2', status: 'DELIVERING' },
        { id: 'd3', status: 'DELIVERING' },
      ],
      new Set(['d1', 'p1']),
    );
    expect(groups.map((group) => [group.label, group.orders.map((order) => order.id)])).toEqual([
      ['배송 중', ['d2', 'd3']],
      ['사진 올리는 중', ['d1']],
      // 수거 대기 주문은 대기열 ID와 겹쳐도 수거 대기 묶음에 그대로 둔다.
      ['수거 대기', ['p1']],
    ]);
  });

  it('배송 중이 모두 사진 대기면 "배송 중" 묶음은 빠진다', () => {
    const groups = groupMapStops([{ id: 'd1', status: 'DELIVERING' }], new Set(['d1']));
    expect(groups.map((group) => group.label)).toEqual(['사진 올리는 중']);
  });

  it('멈춘(failed) 사진의 주문은 다시 보내지 않으므로 "배송 중"에 남는다', () => {
    const groups = groupMapStops(
      [
        { id: 'd1', status: 'DELIVERING' },
        { id: 'd2', status: 'DELIVERING' },
      ],
      inFlightPhotoOrderIds([
        { orderId: 'd1', state: 'failed' },
        { orderId: 'd2', state: 'waiting' },
      ]),
    );
    expect(groups.map((group) => [group.label, group.orders.map((order) => order.id)])).toEqual([
      ['배송 중', ['d1']],
      ['사진 올리는 중', ['d2']],
    ]);
  });
});

describe('groupMapStops 수거 대기 나누기', () => {
  it('assignedToMe를 알면 수거 대기를 내 수거와 맡을 수 있는 주문으로 나눈다', () => {
    const groups = groupMapStops([
      { id: 'o1', status: 'PREPARING', assignedToMe: false },
      { id: 'd1', status: 'DELIVERING', assignedToMe: true },
      { id: 'm1', status: 'PREPARING', assignedToMe: true },
      { id: 'o2', status: 'PREPARING', assignedToMe: false },
    ]);
    expect(groups.map((group) => [group.label, group.orders.map((order) => order.id)])).toEqual([
      ['배송 중', ['d1']],
      ['내 수거', ['m1']],
      ['맡을 수 있는 주문', ['o1', 'o2']],
    ]);
  });

  it('한쪽이 비면 그 묶음은 뺀다', () => {
    const groups = groupMapStops([{ id: 'o1', status: 'PREPARING', assignedToMe: false }]);
    expect(groups.map((group) => group.label)).toEqual(['맡을 수 있는 주문']);
  });

  it('배정 여부를 모르는 주문이 하나라도 있으면 한 묶음("수거 대기")이다', () => {
    const groups = groupMapStops([
      { id: 'm1', status: 'PREPARING', assignedToMe: true },
      { id: 'x', status: 'PREPARING' },
    ]);
    expect(groups.map((group) => [group.label, group.orders.length])).toEqual([['수거 대기', 2]]);
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
