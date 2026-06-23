import type { Category, ColorOption, DeliveryMethod, SaleType } from '@greenhub/shared';
import {
  CATEGORY_TABS,
  CATEGORY_VALUES,
  type CategoryTabValue,
  COLOR_CHIPS,
  COLOR_VALUES,
  DELIVERY_METHOD_CHOICES,
  DELIVERY_METHOD_VALUES,
  SALE_TYPE_VALUES,
  SORT_CHOICES,
  SORT_VALUES,
  type SortOption,
} from './_constants';

export type CategoryQueryPatch = {
  category?: Category | null;
  colors?: ColorOption[] | null;
  deliveryMethod?: DeliveryMethod | null;
  priceMax?: number | null;
  priceMin?: number | null;
  saleType?: SaleType | null;
  sort?: SortOption | null;
};

export interface CategoryQueryState {
  category?: Category;
  colors: ColorOption[];
  deliveryMethod?: DeliveryMethod;
  priceMax?: number;
  priceMin?: number;
  saleType?: SaleType;
  sort: SortOption;
  activeTab: CategoryTabValue;
}

export interface ActiveCategoryFilter {
  key: string;
  label: string;
  removePatch: CategoryQueryPatch;
}

export function parseCategoryQuery(params: URLSearchParams): CategoryQueryState {
  const category = parseCategory(params.get('category'));
  const saleType = parseSaleType(params.get('saleType'));
  const colors = parseColors(params.get('colors'));
  const sort = parseSort(params.get('sort'));
  const priceMin = parsePrice(params.get('priceMin'));
  const priceMax = parsePrice(params.get('priceMax'));
  const deliveryMethod = parseDeliveryMethod(params.get('deliveryMethod'));
  const activeTab: CategoryTabValue = saleType === 'group' ? 'group' : (category ?? 'all');

  return { category, colors, deliveryMethod, priceMax, priceMin, saleType, sort, activeTab };
}

export function buildCategoryQuery(params: URLSearchParams, patch: CategoryQueryPatch) {
  const next = new URLSearchParams(params.toString());

  if ('category' in patch) setOrDelete(next, 'category', patch.category);
  if ('saleType' in patch) setOrDelete(next, 'saleType', patch.saleType);
  if ('deliveryMethod' in patch) setOrDelete(next, 'deliveryMethod', patch.deliveryMethod);
  if ('priceMin' in patch) setNumberOrDelete(next, 'priceMin', patch.priceMin);
  if ('priceMax' in patch) setNumberOrDelete(next, 'priceMax', patch.priceMax);
  if ('sort' in patch) {
    if (!patch.sort || patch.sort === 'latest') next.delete('sort');
    else next.set('sort', patch.sort);
  }
  if ('colors' in patch) {
    if (patch.colors && patch.colors.length > 0) next.set('colors', patch.colors.join(','));
    else next.delete('colors');
  }

  const query = next.toString();
  return query ? `/category?${query}` : '/category';
}

export function buildCategoryProductHref(productId: string, categoryHref: string) {
  const productParams = new URLSearchParams({
    fromCategory: `${categoryHref}#category-product-${productId}`,
  });
  return `/products/${encodeURIComponent(productId)}?${productParams.toString()}`;
}

export function toggleColor(colors: ColorOption[], color: ColorOption) {
  return colors.includes(color) ? colors.filter((item) => item !== color) : [...colors, color];
}

export function buildActiveCategoryFilters(state: CategoryQueryState): ActiveCategoryFilter[] {
  const filters: ActiveCategoryFilter[] = [];

  if (state.saleType === 'group') {
    filters.push({
      key: 'saleType-group',
      label: '공동구매',
      removePatch: { saleType: null },
    });
  }

  if (state.category) {
    filters.push({
      key: `category-${state.category}`,
      label: getCategoryLabel(state.category),
      removePatch: { category: null },
    });
  }

  for (const color of state.colors) {
    filters.push({
      key: `color-${color}`,
      label: getColorLabel(color),
      removePatch: { colors: state.colors.filter((item) => item !== color) },
    });
  }

  if (state.sort !== 'latest') {
    filters.push({
      key: `sort-${state.sort}`,
      label: getSortLabel(state.sort),
      removePatch: { sort: null },
    });
  }

  if (state.priceMin !== undefined || state.priceMax !== undefined) {
    filters.push({
      key: 'price-range',
      label: getPriceRangeLabel(state.priceMin, state.priceMax),
      removePatch: { priceMin: null, priceMax: null },
    });
  }

  if (state.deliveryMethod) {
    filters.push({
      key: `delivery-${state.deliveryMethod}`,
      label: getDeliveryMethodLabel(state.deliveryMethod),
      removePatch: { deliveryMethod: null },
    });
  }

  return filters;
}

export function hasActiveCategoryFilters(state: CategoryQueryState) {
  return buildActiveCategoryFilters(state).length > 0;
}

export const RESET_CATEGORY_FILTERS_PATCH: CategoryQueryPatch = {
  category: null,
  colors: null,
  deliveryMethod: null,
  priceMax: null,
  priceMin: null,
  saleType: null,
  sort: null,
};

function parseCategory(value: string | null): Category | undefined {
  return CATEGORY_VALUES.includes(value as Category) ? (value as Category) : undefined;
}

function parseSaleType(value: string | null): SaleType | undefined {
  return SALE_TYPE_VALUES.includes(value as SaleType) ? (value as SaleType) : undefined;
}

function parseSort(value: string | null): SortOption {
  return SORT_VALUES.includes(value as SortOption) ? (value as SortOption) : 'latest';
}

function parseDeliveryMethod(value: string | null): DeliveryMethod | undefined {
  return DELIVERY_METHOD_VALUES.includes(value as DeliveryMethod)
    ? (value as DeliveryMethod)
    : undefined;
}

function parsePrice(value: string | null): number | undefined {
  if (!value) return undefined;
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : undefined;
}

function parseColors(value: string | null): ColorOption[] {
  if (!value) return [];
  const colors = value
    .split(',')
    .filter((item): item is ColorOption => COLOR_VALUES.includes(item as ColorOption));
  return Array.from(new Set(colors));
}

function setOrDelete(params: URLSearchParams, key: string, value: string | null | undefined) {
  if (value) params.set(key, value);
  else params.delete(key);
}

function setNumberOrDelete(params: URLSearchParams, key: string, value: number | null | undefined) {
  if (value !== undefined && value !== null && Number.isFinite(value) && value >= 0) {
    params.set(key, String(value));
  } else {
    params.delete(key);
  }
}

function getCategoryLabel(category: Category) {
  return CATEGORY_TABS.find((tab) => tab.value === category)?.label ?? category;
}

function getColorLabel(color: ColorOption) {
  return COLOR_CHIPS.find((chip) => chip.value === color)?.label ?? color;
}

function getSortLabel(sort: SortOption) {
  return SORT_CHOICES.find((choice) => choice.value === sort)?.label ?? sort;
}

function getDeliveryMethodLabel(method: DeliveryMethod) {
  return DELIVERY_METHOD_CHOICES.find((choice) => choice.value === method)?.label ?? method;
}

function getPriceRangeLabel(priceMin?: number, priceMax?: number) {
  if (priceMin !== undefined && priceMax !== undefined) {
    return `${priceMin.toLocaleString()}원~${priceMax.toLocaleString()}원`;
  }
  if (priceMin !== undefined) return `${priceMin.toLocaleString()}원 이상`;
  if (priceMax !== undefined) return `${priceMax.toLocaleString()}원 이하`;
  return '가격';
}
