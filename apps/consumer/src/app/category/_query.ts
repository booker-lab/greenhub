import type { Category, ColorOption, SaleType } from '@greenhub/shared';
import {
  CATEGORY_VALUES,
  type CategoryTabValue,
  COLOR_VALUES,
  SALE_TYPE_VALUES,
  SORT_VALUES,
  type SortOption,
} from './_constants';

export interface CategoryQueryState {
  category?: Category;
  colors: ColorOption[];
  saleType?: SaleType;
  sort: SortOption;
  activeTab: CategoryTabValue;
}

export function parseCategoryQuery(params: URLSearchParams): CategoryQueryState {
  const category = parseCategory(params.get('category'));
  const saleType = parseSaleType(params.get('saleType'));
  const colors = parseColors(params.get('colors'));
  const sort = parseSort(params.get('sort'));
  const activeTab: CategoryTabValue = saleType === 'group' ? 'group' : (category ?? 'all');

  return { category, colors, saleType, sort, activeTab };
}

export function buildCategoryQuery(
  params: URLSearchParams,
  patch: {
    category?: Category | null;
    colors?: ColorOption[] | null;
    saleType?: SaleType | null;
    sort?: SortOption | null;
  },
) {
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
