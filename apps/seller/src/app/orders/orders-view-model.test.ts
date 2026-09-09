import type { Order, OrderStatus } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import type { GroupConfigMap, OrderGroup } from './_constants';
import {
  buildOrdersScopedViewModel,
  buildOrdersViewModel,
  collectGroupProductIds,
  countOrdersByGroup,
  deriveOrdersFetchInput,
  filterBySaleType,
  filterOrdersForView,
  groupFilteredOrdersByDate,
  isCustomRangeInvalid,
  resolveOrdersDateRange,
  type InDeliverySubFilter,
} from './orders-view-model';

let seq = 0;

function makeOrder(overrides: Partial<Order> & { status: OrderStatus }): Order {
  seq += 1;
  const base = {
    id: `order-${seq}`,
    storeId: 'store-1',
    userId: 'user-1',
    productId: `product-${seq}`,
    quantity: 1,
    saleType: 'normal',
    deliveryMethod: 'direct',
    deliveryFee: 0,
    deliveryAddress: { address: '서울', addressDetail: '101', zipCode: '00000' },
    isMetropolitan: true,
    hubId: null,
    pickupCode: null,
    totalAmount: 10000,
    requestedDeliveryDate: null,
    preparedAt: null,
    cancelReason: null,
    groupBuyConsent: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  return { ...base, ...overrides } as Order;
}

/** 실행 시점 기준 ±offset일 ISO — overdue/today/future 분류를 flake 없이 고정 */
function isoDaysFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString();
}

function dateKeyDaysFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const NO_RANGE = null;

function viewFilter(
  activeTab: OrderGroup,
  overrides?: Partial<{
    subFilter: InDeliverySubFilter;
    heldOnly: boolean;
    groupConfigMap: GroupConfigMap;
  }>,
) {
  return {
    activeTab,
    subFilter: 'ALL' as InDeliverySubFilter,
    heldOnly: false,
    dateRange: NO_RANGE,
    groupConfigMap: undefined,
    ...overrides,
  };
}

describe('판매 유형 1차 분기', () => {
  it('일반 토글은 group 주문을 제외하고 공구 토글은 group만 남긴다', () => {
    const normal = makeOrder({ status: 'PENDING', saleType: 'normal' });
    const group = makeOrder({ status: 'PENDING', saleType: 'group' });

    expect(filterBySaleType([normal, group], 'normal').map((o) => o.id)).toEqual([normal.id]);
    expect(filterBySaleType([normal, group], 'group').map((o) => o.id)).toEqual([group.id]);
  });
});

describe('5-tab semantics', () => {
  const cases: [OrderStatus, OrderGroup][] = [
    ['PENDING', 'ACTION_REQUIRED'],
    ['RECRUITING', 'ACTION_REQUIRED'],
    ['ACCEPTED', 'ACTION_REQUIRED'],
    ['CONFIRMED', 'ACTION_REQUIRED'],
    ['DELIVERY_HELD', 'ACTION_REQUIRED'],
    ['PREPARING', 'WAITING'],
    ['DELIVERING', 'IN_DELIVERY'],
    ['HUB_ARRIVED', 'IN_DELIVERY'],
    ['DELIVERED', 'DONE'],
    ['PICKED_UP', 'DONE'],
    ['REVIEWED', 'DONE'],
    ['CANCELLED', 'CANCELLED'],
  ];

  it.each([
    ['ACTION_REQUIRED'],
    ['WAITING'],
    ['IN_DELIVERY'],
    ['DONE'],
    ['CANCELLED'],
  ] as [OrderGroup][])('%s 탭은 매핑된 상태만 표시한다', (tab) => {
    const orders = cases.map(([status]) => makeOrder({ status }));
    const filtered = filterOrdersForView(filterBySaleType(orders, 'normal'), viewFilter(tab));
    const expected = cases.filter(([, group]) => group === tab).map(([status]) => status);
    expect(filtered.map((o) => o.status).sort()).toEqual([...expected].sort());
  });

  it('입력 순서를 유지한다', () => {
    const orders = [
      makeOrder({ status: 'CONFIRMED' }),
      makeOrder({ status: 'PENDING' }),
      makeOrder({ status: 'DELIVERY_HELD' }),
    ];
    const filtered = filterOrdersForView(
      filterBySaleType(orders, 'normal'),
      viewFilter('ACTION_REQUIRED'),
    );
    expect(filtered.map((o) => o.id)).toEqual(orders.map((o) => o.id));
  });
});

describe('heldOnly 격리', () => {
  it('ACTION_REQUIRED에서 heldOnly=true면 DELIVERY_HELD만 격리한다', () => {
    const orders = [
      makeOrder({ status: 'PENDING' }),
      makeOrder({ status: 'ACCEPTED' }),
      makeOrder({ status: 'DELIVERY_HELD' }),
      makeOrder({ status: 'DELIVERY_HELD' }),
    ];
    const held = filterOrdersForView(
      filterBySaleType(orders, 'normal'),
      viewFilter('ACTION_REQUIRED', { heldOnly: true }),
    );
    expect(held).toHaveLength(2);
    expect(held.every((o) => o.status === 'DELIVERY_HELD')).toBe(true);

    const all = filterOrdersForView(
      filterBySaleType(orders, 'normal'),
      viewFilter('ACTION_REQUIRED', { heldOnly: false }),
    );
    expect(all).toHaveLength(4);
  });
});

describe('IN_DELIVERY subFilter', () => {
  it('ALL/DELIVERING/HUB_ARRIVED 선택을 그대로 반영한다', () => {
    const orders = [
      makeOrder({ status: 'DELIVERING' }),
      makeOrder({ status: 'DELIVERING' }),
      makeOrder({ status: 'HUB_ARRIVED' }),
      makeOrder({ status: 'PREPARING' }),
    ];
    const scoped = filterBySaleType(orders, 'normal');
    expect(
      filterOrdersForView(scoped, viewFilter('IN_DELIVERY', { subFilter: 'ALL' })),
    ).toHaveLength(3);
    const delivering = filterOrdersForView(
      scoped,
      viewFilter('IN_DELIVERY', { subFilter: 'DELIVERING' }),
    );
    expect(delivering).toHaveLength(2);
    expect(delivering.every((o) => o.status === 'DELIVERING')).toBe(true);
    const hub = filterOrdersForView(
      scoped,
      viewFilter('IN_DELIVERY', { subFilter: 'HUB_ARRIVED' }),
    );
    expect(hub).toHaveLength(1);
    expect(hub[0]?.status).toBe('HUB_ARRIVED');
  });
});

describe('날짜 preset/range', () => {
  it('custom 범위는 범위 밖만 제외하고 날짜 미정(null)은 내려보낸다', () => {
    const inRange = makeOrder({
      status: 'PENDING',
      requestedDeliveryDate: '2026-09-05T12:00:00',
    });
    const outOfRange = makeOrder({
      status: 'PENDING',
      requestedDeliveryDate: '2026-09-20T12:00:00',
    });
    const undated = makeOrder({ status: 'PENDING', requestedDeliveryDate: null });
    const dateRange = resolveOrdersDateRange(
      'normal',
      'custom',
      'ACTION_REQUIRED',
      '2026-09-01',
      '2026-09-10',
    );
    expect(dateRange).not.toBeNull();

    const filtered = filterOrdersForView(filterBySaleType([inRange, outOfRange, undated], 'normal'), {
      ...viewFilter('ACTION_REQUIRED'),
      dateRange,
    });
    expect(filtered.map((o) => o.id)).toEqual([inRange.id, undated.id]);
  });

  it('공구 토글은 날짜 범위를 만들지 않아 날짜 필터를 적용하지 않는다', () => {
    expect(resolveOrdersDateRange('group', 'week', 'ACTION_REQUIRED', '', '')).toBeNull();
    const far = makeOrder({
      status: 'PENDING',
      saleType: 'group',
      requestedDeliveryDate: '2020-01-01T12:00:00',
    });
    const filtered = filterOrdersForView(
      filterBySaleType([far], 'group'),
      viewFilter('ACTION_REQUIRED'),
    );
    expect(filtered).toHaveLength(1);
  });

  it('공동구매 주문은 groupDeliveryDate 조인으로 날짜 필터를 적용한다', () => {
    const groupConfigMap: GroupConfigMap = {
      'p-in': { groupDeliveryDate: '2026-09-05T12:00:00' },
      'p-out': { groupDeliveryDate: '2026-09-20T12:00:00' },
    };
    const inRange = makeOrder({ status: 'PREPARING', saleType: 'group', productId: 'p-in' });
    const outOfRange = makeOrder({ status: 'PREPARING', saleType: 'group', productId: 'p-out' });
    const missing = makeOrder({ status: 'PREPARING', saleType: 'group', productId: 'p-missing' });
    const dateRange = { from: new Date('2026-09-01T00:00:00'), to: new Date('2026-09-10T23:59:59') };

    const filtered = filterOrdersForView(filterBySaleType([inRange, outOfRange, missing], 'group'), {
      ...viewFilter('WAITING'),
      dateRange,
      groupConfigMap,
    });
    expect(filtered.map((o) => o.productId)).toEqual(['p-in', 'p-missing']);
  });

  it('시작일이 종료일보다 늦으면 invalid이며 범위 없이 날짜 필터를 미적용한다', () => {
    expect(isCustomRangeInvalid('custom', '2026-09-10', '2026-09-01')).toBe(true);
    expect(isCustomRangeInvalid('custom', '2026-09-01', '2026-09-10')).toBe(false);
    expect(isCustomRangeInvalid('custom', '', '')).toBe(false);
    expect(isCustomRangeInvalid('week', '', '')).toBe(false);
    expect(
      resolveOrdersDateRange('normal', 'custom', 'ACTION_REQUIRED', '2026-09-10', '2026-09-01'),
    ).toBeNull();
  });
});

describe('탭 뱃지 집계 scope', () => {
  it('판매 유형 scope 안에서만 집계한다', () => {
    const orders = [
      makeOrder({ status: 'PENDING', saleType: 'normal' }),
      makeOrder({ status: 'DELIVERING', saleType: 'normal' }),
      makeOrder({ status: 'PENDING', saleType: 'group' }),
    ];
    expect(countOrdersByGroup(filterBySaleType(orders, 'normal'))).toEqual({
      ACTION_REQUIRED: 1,
      WAITING: 0,
      IN_DELIVERY: 1,
      DONE: 0,
      CANCELLED: 0,
    });
    expect(countOrdersByGroup(filterBySaleType(orders, 'group'))).toEqual({
      ACTION_REQUIRED: 1,
      WAITING: 0,
      IN_DELIVERY: 0,
      DONE: 0,
      CANCELLED: 0,
    });
  });
});

describe('DELIVERY_HELD priority 1:1', () => {
  it('배송 보류 진입(heldOnly)은 priority count와 목록이 일치한다', () => {
    const orders = [
      makeOrder({ status: 'DELIVERY_HELD' }),
      makeOrder({ status: 'PENDING' }),
      makeOrder({ status: 'DELIVERY_HELD' }),
      makeOrder({ status: 'ACCEPTED' }),
    ];
    const vm = buildOrdersViewModel({
      orders,
      saleType: 'normal',
      activeTab: 'ACTION_REQUIRED',
      subFilter: 'ALL',
      heldOnly: true,
      datePreset: 'custom',
      customFrom: '',
      customTo: '',
    });
    expect(vm.priorityCounts.deliveryHeld).toBe(2);
    expect(vm.priorityCounts.actionRequired).toBe(4);
    expect(vm.filteredOrders).toHaveLength(vm.priorityCounts.deliveryHeld);
    expect(vm.filteredOrders.every((o) => o.status === 'DELIVERY_HELD')).toBe(true);
  });
});

describe('날짜 grouping 파생 데이터', () => {
  it('활성 탭은 overdue → 날짜 ASC → undated 순으로 그룹핑한다', () => {
    const overdue = makeOrder({ status: 'PREPARING', requestedDeliveryDate: isoDaysFromToday(-10) });
    const future = makeOrder({ status: 'PREPARING', requestedDeliveryDate: isoDaysFromToday(10) });
    const undated = makeOrder({ status: 'PREPARING', requestedDeliveryDate: null });
    const vm = buildOrdersViewModel({
      orders: [overdue, future, undated],
      saleType: 'normal',
      activeTab: 'WAITING',
      subFilter: 'ALL',
      heldOnly: false,
      datePreset: 'custom',
      customFrom: '',
      customTo: '',
    });
    expect(vm.groupedOrders.map((g) => g.dateKey)).toEqual([
      'overdue',
      dateKeyDaysFromToday(10),
      'undated',
    ]);
    expect(vm.groupedOrders[0]?.orders.map((o) => o.id)).toEqual([overdue.id]);
  });

  it('활성 탭 그룹 내부는 createdAt ASC, 아카이브 탭은 DESC로 정렬한다', () => {
    const early = makeOrder({
      status: 'PREPARING',
      requestedDeliveryDate: isoDaysFromToday(10),
      createdAt: '2026-09-05T10:00:00',
    });
    const late = makeOrder({
      status: 'PREPARING',
      requestedDeliveryDate: isoDaysFromToday(10),
      createdAt: '2026-09-05T18:00:00',
    });
    const active = groupFilteredOrdersByDate([late, early], 'WAITING');
    expect(active).toHaveLength(1);
    expect(active[0]?.orders.map((o) => o.id)).toEqual([early.id, late.id]);

    const doneEarly = makeOrder({ status: 'DELIVERED', createdAt: '2026-09-05T10:00:00' });
    const doneLate = makeOrder({ status: 'DELIVERED', createdAt: '2026-09-05T18:00:00' });
    const archive = groupFilteredOrdersByDate([doneEarly, doneLate], 'DONE');
    expect(archive).toHaveLength(1);
    expect(archive[0]?.orders.map((o) => o.id)).toEqual([doneLate.id, doneEarly.id]);
  });
});

describe('조합 regression', () => {
  it('saleType + tab + heldOnly + custom 범위 조합에서 정확히 일치하는 주문만 남는다', () => {
    const keep = makeOrder({
      status: 'DELIVERY_HELD',
      saleType: 'normal',
      requestedDeliveryDate: '2026-09-05T12:00:00',
    });
    const outOfRange = makeOrder({
      status: 'DELIVERY_HELD',
      saleType: 'normal',
      requestedDeliveryDate: '2026-09-20T12:00:00',
    });
    const notHeld = makeOrder({
      status: 'PENDING',
      saleType: 'normal',
      requestedDeliveryDate: '2026-09-05T12:00:00',
    });
    const groupHeld = makeOrder({
      status: 'DELIVERY_HELD',
      saleType: 'group',
      requestedDeliveryDate: '2026-09-05T12:00:00',
    });
    const wrongTab = makeOrder({
      status: 'DELIVERING',
      saleType: 'normal',
      requestedDeliveryDate: '2026-09-05T12:00:00',
    });
    const vm = buildOrdersViewModel({
      orders: [keep, outOfRange, notHeld, groupHeld, wrongTab],
      saleType: 'normal',
      activeTab: 'ACTION_REQUIRED',
      subFilter: 'ALL',
      heldOnly: true,
      datePreset: 'custom',
      customFrom: '2026-09-01',
      customTo: '2026-09-10',
    });
    expect(vm.customInvalid).toBe(false);
    expect(vm.filteredOrders.map((o) => o.id)).toEqual([keep.id]);
    expect(vm.groupedOrders.flatMap((g) => g.orders).map((o) => o.id)).toEqual([keep.id]);
  });
});

describe('공구 productId 수집', () => {
  it('일반 토글은 빈 배열, 공구 토글은 활성 탭 주문의 productId만 모은다', () => {
    const inTab = makeOrder({ status: 'PENDING', saleType: 'group', productId: 'p-1' });
    const otherTab = makeOrder({ status: 'PREPARING', saleType: 'group', productId: 'p-2' });
    expect(collectGroupProductIds([inTab, otherTab], 'normal', 'ACTION_REQUIRED')).toEqual([]);
    expect(collectGroupProductIds([inTab, otherTab], 'group', 'ACTION_REQUIRED')).toEqual(['p-1']);
  });
});

describe('2-phase ownership (SLICE-02)', () => {
  it('PHASE_1은 saleType scope를 한 번만 수행하고 같은 참조를 재사용한다', () => {
    const normal = makeOrder({ status: 'PENDING', saleType: 'normal', productId: 'p-n' });
    const groupInTab = makeOrder({ status: 'PENDING', saleType: 'group', productId: 'p-1' });
    const groupOtherTab = makeOrder({ status: 'PREPARING', saleType: 'group', productId: 'p-2' });
    const orders = [normal, groupInTab, groupOtherTab];

    const fetchInput = deriveOrdersFetchInput(orders, 'group', 'ACTION_REQUIRED');
    expect(fetchInput.saleTypeOrders.map((o) => o.id)).toEqual(
      filterBySaleType(orders, 'group').map((o) => o.id),
    );
    expect(fetchInput.groupProductIds).toEqual(
      collectGroupProductIds(fetchInput.saleTypeOrders, 'group', 'ACTION_REQUIRED'),
    );
    expect(fetchInput.groupProductIds).toEqual(['p-1']);

    const normalFetch = deriveOrdersFetchInput(orders, 'normal', 'ACTION_REQUIRED');
    expect(normalFetch.saleTypeOrders.map((o) => o.id)).toEqual([normal.id]);
    expect(normalFetch.groupProductIds).toEqual([]);
  });

  it('PHASE_2는 같은 scope 참조에서 뱃지 counts와 filtered를 함께 파생한다', () => {
    const orders = [
      makeOrder({ status: 'PENDING', saleType: 'normal' }),
      makeOrder({ status: 'DELIVERING', saleType: 'normal' }),
      makeOrder({ status: 'PENDING', saleType: 'group' }),
    ];
    const fetchInput = deriveOrdersFetchInput(orders, 'normal', 'ACTION_REQUIRED');
    const scoped = buildOrdersScopedViewModel({
      saleTypeOrders: fetchInput.saleTypeOrders,
      saleType: 'normal',
      activeTab: 'ACTION_REQUIRED',
      subFilter: 'ALL',
      heldOnly: false,
      datePreset: 'custom',
      customFrom: '',
      customTo: '',
    });
    // counts는 표시 목록과 동일한 saleType scope에서 집계된다.
    expect(scoped.scopedGroupCounts).toEqual(countOrdersByGroup(fetchInput.saleTypeOrders));
    expect(scoped.scopedGroupCounts.ACTION_REQUIRED).toBe(1);
    // filtered는 counts와 같은 scope 배열의 부분집합이다.
    expect(scoped.filteredOrders.every((o) => fetchInput.saleTypeOrders.includes(o))).toBe(true);
    expect(scoped.priorityCounts.actionRequired).toBe(1);
  });

  it('page가 제거한 수동 파생과 2-phase 조합이 동일하다', () => {
    const keep = makeOrder({
      status: 'DELIVERY_HELD',
      saleType: 'normal',
      requestedDeliveryDate: '2026-09-05T12:00:00',
    });
    const outOfRange = makeOrder({
      status: 'DELIVERY_HELD',
      saleType: 'normal',
      requestedDeliveryDate: '2026-09-20T12:00:00',
    });
    const groupNoise = makeOrder({
      status: 'DELIVERY_HELD',
      saleType: 'group',
      requestedDeliveryDate: '2026-09-05T12:00:00',
    });
    const orders = [keep, outOfRange, groupNoise];

    // 제거 전 page 수동 파생 (SLICE-01 구조와 동일).
    const saleTypeOrders = filterBySaleType(orders, 'normal');
    const expectedCounts = countOrdersByGroup(saleTypeOrders);
    const expectedRange = resolveOrdersDateRange(
      'normal',
      'custom',
      'ACTION_REQUIRED',
      '2026-09-01',
      '2026-09-10',
    );
    const expectedFiltered = filterOrdersForView(saleTypeOrders, {
      activeTab: 'ACTION_REQUIRED',
      subFilter: 'ALL',
      heldOnly: true,
      dateRange: expectedRange,
      groupConfigMap: undefined,
    });
    const expectedGrouped = groupFilteredOrdersByDate(
      expectedFiltered,
      'ACTION_REQUIRED',
      undefined,
    );

    // 현재 page 경로: PHASE_1 → PHASE_2 (같은 참조 연결).
    const fetchInput = deriveOrdersFetchInput(orders, 'normal', 'ACTION_REQUIRED');
    const scoped = buildOrdersScopedViewModel({
      saleTypeOrders: fetchInput.saleTypeOrders,
      saleType: 'normal',
      activeTab: 'ACTION_REQUIRED',
      subFilter: 'ALL',
      heldOnly: true,
      datePreset: 'custom',
      customFrom: '2026-09-01',
      customTo: '2026-09-10',
    });

    expect(fetchInput.saleTypeOrders.map((o) => o.id)).toEqual(
      saleTypeOrders.map((o) => o.id),
    );
    expect(scoped.scopedGroupCounts).toEqual(expectedCounts);
    expect(scoped.dateRange?.from.getTime()).toBe(expectedRange?.from.getTime());
    expect(scoped.dateRange?.to.getTime()).toBe(expectedRange?.to.getTime());
    expect(scoped.filteredOrders.map((o) => o.id)).toEqual(
      expectedFiltered.map((o) => o.id),
    );
    expect(scoped.groupedOrders.map((g) => g.dateKey)).toEqual(
      expectedGrouped.map((g) => g.dateKey),
    );

    // 단일 진입 조합과도 동일하다.
    const combined = buildOrdersViewModel({
      orders,
      saleType: 'normal',
      activeTab: 'ACTION_REQUIRED',
      subFilter: 'ALL',
      heldOnly: true,
      datePreset: 'custom',
      customFrom: '2026-09-01',
      customTo: '2026-09-10',
    });
    expect(combined.scopedGroupCounts).toEqual(scoped.scopedGroupCounts);
    expect(combined.filteredOrders.map((o) => o.id)).toEqual(
      scoped.filteredOrders.map((o) => o.id),
    );
    expect(combined.groupedOrders.map((g) => g.dateKey)).toEqual(
      scoped.groupedOrders.map((g) => g.dateKey),
    );
    expect(combined.groupProductIds).toEqual(fetchInput.groupProductIds);
  });

  it('공구 + groupConfigMap에서도 PHASE_1/2 조합이 단일 진입과 동일하다', () => {
    const groupConfigMap: GroupConfigMap = {
      'p-in': { groupDeliveryDate: '2026-09-05T12:00:00' },
    };
    const inTab = makeOrder({ status: 'PENDING', saleType: 'group', productId: 'p-in' });
    const otherTab = makeOrder({ status: 'PREPARING', saleType: 'group', productId: 'p-other' });
    const orders = [inTab, otherTab];

    const fetchInput = deriveOrdersFetchInput(orders, 'group', 'ACTION_REQUIRED');
    expect(fetchInput.groupProductIds).toEqual(['p-in']);
    const scoped = buildOrdersScopedViewModel({
      saleTypeOrders: fetchInput.saleTypeOrders,
      saleType: 'group',
      activeTab: 'ACTION_REQUIRED',
      subFilter: 'ALL',
      heldOnly: false,
      datePreset: 'week',
      customFrom: '',
      customTo: '',
      groupConfigMap,
    });
    const combined = buildOrdersViewModel({
      orders,
      saleType: 'group',
      activeTab: 'ACTION_REQUIRED',
      subFilter: 'ALL',
      heldOnly: false,
      datePreset: 'week',
      customFrom: '',
      customTo: '',
      groupConfigMap,
    });
    // 공구는 날짜 범위를 만들지 않으므로 필터가 그대로 통과한다.
    expect(scoped.dateRange).toBeNull();
    expect(scoped.filteredOrders.map((o) => o.id)).toEqual([inTab.id]);
    expect(combined.filteredOrders.map((o) => o.id)).toEqual(
      scoped.filteredOrders.map((o) => o.id),
    );
    expect(combined.scopedGroupCounts).toEqual(scoped.scopedGroupCounts);
  });
});
