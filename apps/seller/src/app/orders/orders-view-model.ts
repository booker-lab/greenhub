import type { Order, SaleType } from '@greenhub/shared';
import {
  type DateGroup,
  type DateRangePreset,
  getDateRange,
  getOrderDate,
  groupOrdersByDate,
  type GroupConfigMap,
  type OrderGroup,
  STATUS_GROUP_MAP,
} from './_constants';
import {
  getOrderPriorityCounts,
  type OrderPriorityCounts,
  shouldShowActionRequiredOrder,
} from './order-priority';

/** IN_DELIVERY 탭 하위 필터 — page의 subFilter state와 동일한 vocabulary */
export type InDeliverySubFilter = 'ALL' | 'DELIVERING' | 'HUB_ARRIVED';

export interface OrdersListFilter {
  activeTab: OrderGroup;
  subFilter: InDeliverySubFilter;
  heldOnly: boolean;
  dateRange: { from: Date; to: Date } | null;
  groupConfigMap?: GroupConfigMap;
}

export interface OrdersViewModelInput {
  orders: Order[];
  saleType: SaleType;
  activeTab: OrderGroup;
  subFilter: InDeliverySubFilter;
  heldOnly: boolean;
  datePreset: DateRangePreset;
  customFrom: string;
  customTo: string;
  groupConfigMap?: GroupConfigMap;
}

export interface OrdersViewModel {
  saleTypeOrders: Order[];
  priorityCounts: OrderPriorityCounts;
  scopedGroupCounts: Record<OrderGroup, number>;
  customInvalid: boolean;
  dateRange: { from: Date; to: Date } | null;
  groupProductIds: string[];
  filteredOrders: Order[];
  groupedOrders: DateGroup[];
}

/**
 * PHASE_1_INPUT_DERIVATION — fetch boundary 이전 순수 계산.
 * useGroupConfigs(productIds)가 fetch에 필요하므로 raw orders를 saleType으로
 * 한 번만 scope하고, 같은 참조에서 group fetch용 productIds를 함께 파생한다.
 * 반환된 saleTypeOrders 참조를 PHASE_2에 그대로 전달하면 scope 중복이 없다.
 */
export interface OrdersFetchInput {
  saleTypeOrders: Order[];
  groupProductIds: string[];
}

/**
 * PHASE_2_VIEW_MODEL — fetch boundary 이후 순수 계산 입력.
 * saleTypeOrders는 PHASE_1이 반환한 동일 참조를 전달한다. saleType은
 * 재-scope용이 아니라 resolveOrdersDateRange(normal/group 분기)용이다.
 */
export interface OrdersScopedViewInput {
  saleTypeOrders: Order[];
  saleType: SaleType;
  activeTab: OrderGroup;
  subFilter: InDeliverySubFilter;
  heldOnly: boolean;
  datePreset: DateRangePreset;
  customFrom: string;
  customTo: string;
  groupConfigMap?: GroupConfigMap;
}

/** PHASE_2 출력 — 뱃지/목록/그룹핑 렌더 데이터 (fetch input 제외). */
export interface OrdersScopedView {
  priorityCounts: OrderPriorityCounts;
  scopedGroupCounts: Record<OrderGroup, number>;
  customInvalid: boolean;
  dateRange: { from: Date; to: Date } | null;
  filteredOrders: Order[];
  groupedOrders: DateGroup[];
}

/** 판매 유형 1차 분기 — 일반은 group 제외, 공구는 group만 */
export function filterBySaleType(orders: Order[], saleType: SaleType): Order[] {
  return orders.filter((order) =>
    saleType === 'group' ? order.saleType === 'group' : order.saleType !== 'group',
  );
}

/** 탭 뱃지 집계 — 표시 목록과 동일한 판매 유형 scope로 집계한다 */
export function countOrdersByGroup(orders: Order[]): Record<OrderGroup, number> {
  const result: Record<OrderGroup, number> = {
    ACTION_REQUIRED: 0,
    WAITING: 0,
    IN_DELIVERY: 0,
    DONE: 0,
    CANCELLED: 0,
  };
  for (const order of orders) {
    result[STATUS_GROUP_MAP[order.status]] += 1;
  }
  return result;
}

/** 직접 입력 범위 유효성 — 시작일이 종료일보다 늦으면 true */
export function isCustomRangeInvalid(
  preset: DateRangePreset,
  customFrom: string,
  customTo: string,
): boolean {
  return preset === 'custom' && !!customFrom && !!customTo && customFrom > customTo;
}

/** 날짜 범위 계산 — 공구 토글은 날짜 필터 칩 미노출이므로 범위 자체를 만들지 않는다 */
export function resolveOrdersDateRange(
  saleType: SaleType,
  preset: DateRangePreset,
  tab: OrderGroup,
  customFrom = '',
  customTo = '',
): { from: Date; to: Date } | null {
  return saleType === 'normal' ? getDateRange(preset, tab, customFrom, customTo) : null;
}

/** 공구 토글일 때만 표시 후보 productId를 모아 groupProductConfig 일괄 fetch에 사용 */
export function collectGroupProductIds(
  saleTypeOrders: Order[],
  saleType: SaleType,
  activeTab: OrderGroup,
): string[] {
  if (saleType !== 'group') return [];
  return saleTypeOrders
    .filter((order) => STATUS_GROUP_MAP[order.status] === activeTab)
    .map((order) => order.productId);
}

/**
 * 표시 목록 필터 — 입력 순서 유지.
 * requestedDeliveryDate = null(공동구매 등)은 제외하지 않고 "날짜 미정"으로 내려보낸다 (T6).
 */
export function filterOrdersForView(
  saleTypeOrders: Order[],
  filter: OrdersListFilter,
): Order[] {
  const { activeTab, subFilter, heldOnly, dateRange, groupConfigMap } = filter;
  return saleTypeOrders.filter((order) => {
    if (STATUS_GROUP_MAP[order.status] !== activeTab) return false;
    if (activeTab === 'ACTION_REQUIRED' && !shouldShowActionRequiredOrder(order.status, heldOnly)) {
      return false;
    }
    if (activeTab === 'IN_DELIVERY' && subFilter !== 'ALL' && order.status !== subFilter) {
      return false;
    }
    if (dateRange) {
      const d = getOrderDate(order, activeTab, groupConfigMap);
      if (d && (d < dateRange.from || d > dateRange.to)) return false;
    }
    return true;
  });
}

/** 날짜 그룹 섹션용 파생 데이터 */
export function groupFilteredOrdersByDate(
  filteredOrders: Order[],
  tab: OrderGroup,
  groupConfigMap?: GroupConfigMap,
): DateGroup[] {
  return groupOrdersByDate(filteredOrders, tab, groupConfigMap);
}

/** page의 파생 계산 전체를 같은 순서로 조합한다 */
export function deriveOrdersFetchInput(
  orders: Order[],
  saleType: SaleType,
  activeTab: OrderGroup,
): OrdersFetchInput {
  const saleTypeOrders = filterBySaleType(orders, saleType);
  return {
    saleTypeOrders,
    groupProductIds: collectGroupProductIds(saleTypeOrders, saleType, activeTab),
  };
}

/**
 * PHASE_2 — 이미 scope된 동일 참조에서 counts와 filtered를 함께 파생한다.
 * 뱃지와 목록이 서로 다른 scope 배열에서 계산되는 구조적 불일치가 불가능하다.
 */
export function buildOrdersScopedViewModel(input: OrdersScopedViewInput): OrdersScopedView {
  const {
    saleTypeOrders,
    saleType,
    activeTab,
    subFilter,
    heldOnly,
    datePreset,
    customFrom,
    customTo,
    groupConfigMap,
  } = input;
  const dateRange = resolveOrdersDateRange(saleType, datePreset, activeTab, customFrom, customTo);
  const filteredOrders = filterOrdersForView(saleTypeOrders, {
    activeTab,
    subFilter,
    heldOnly,
    dateRange,
    groupConfigMap,
  });
  return {
    priorityCounts: getOrderPriorityCounts(saleTypeOrders),
    scopedGroupCounts: countOrdersByGroup(saleTypeOrders),
    customInvalid: isCustomRangeInvalid(datePreset, customFrom, customTo),
    dateRange,
    filteredOrders,
    groupedOrders: groupFilteredOrdersByDate(filteredOrders, activeTab, groupConfigMap),
  };
}

/**
 * 단일 진입 조합 — PHASE_1 + PHASE_2를 같은 saleTypeOrders 참조로 연결한다.
 * fetch가 필요 없는 테스트/단순 호출용. page는 hook 경계 때문에 두 함수를
 * 직접 순서대로 호출하고, 이 함수는 그 조합과 동일함을 보장한다.
 */
export function buildOrdersViewModel(input: OrdersViewModelInput): OrdersViewModel {
  const {
    orders,
    saleType,
    activeTab,
    subFilter,
    heldOnly,
    datePreset,
    customFrom,
    customTo,
    groupConfigMap,
  } = input;
  const fetchInput = deriveOrdersFetchInput(orders, saleType, activeTab);
  const scoped = buildOrdersScopedViewModel({
    saleTypeOrders: fetchInput.saleTypeOrders,
    saleType,
    activeTab,
    subFilter,
    heldOnly,
    datePreset,
    customFrom,
    customTo,
    groupConfigMap,
  });
  return {
    saleTypeOrders: fetchInput.saleTypeOrders,
    groupProductIds: fetchInput.groupProductIds,
    ...scoped,
  };
}
