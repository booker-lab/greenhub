import type { Category, ColorOption, SaleType } from '@greenhub/shared';
import {
  CATEGORY_TABS,
  CATEGORY_VALUES,
  type CategoryTabValue,
  COLOR_CHIPS,
  COLOR_VALUES,
  SALE_TYPE_VALUES,
  SORT_CHOICES,
  SORT_VALUES,
  type SortOption,
} from './_constants';

export type CategoryQueryPatch = {
  category?: Category | null;
  colors?: ColorOption[] | null;
  saleType?: SaleType | null;
  sort?: SortOption | null;
};

export interface CategoryQueryState {
  category?: Category;
  colors: ColorOption[];
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
  const activeTab: CategoryTabValue = saleType === 'group' ? 'group' : (category ?? 'all');

  return { category, colors, saleType, sort, activeTab };
}

export function buildCategoryQuery(params: URLSearchParams, patch: CategoryQueryPatch) {
  const next = new URLSearchParams(params.toString());

  if ('category' in patch) setOrDelete(next, 'category', patch.category);
  if ('saleType' in patch) setOrDelete(next, 'saleType', patch.saleType);
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

  return filters;
}

export function hasActiveCategoryFilters(state: CategoryQueryState) {
  return buildActiveCategoryFilters(state).length > 0;
}

export const RESET_CATEGORY_FILTERS_PATCH: CategoryQueryPatch = {
  category: null,
  colors: null,
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

function getCategoryLabel(category: Category) {
  return CATEGORY_TABS.find((tab) => tab.value === category)?.label ?? category;
}

function getColorLabel(color: ColorOption) {
  return COLOR_CHIPS.find((chip) => chip.value === color)?.label ?? color;
}

function getSortLabel(sort: SortOption) {
  return SORT_CHOICES.find((choice) => choice.value === sort)?.label ?? sort;
}
