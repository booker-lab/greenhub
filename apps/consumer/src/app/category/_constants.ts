import type { Category, ColorOption, SaleType } from '@greenhub/shared';

export type SortOption = 'latest' | 'popular' | 'price_asc' | 'price_desc';

export type CategoryTabValue = 'all' | 'group' | Category;

export interface CategoryTab {
  label: string;
  value: CategoryTabValue;
}

export interface ColorChip {
  label: string;
  value: ColorOption;
  hex: string;
}

export interface SortChoice {
  label: string;
  value: SortOption;
}

export const CATEGORY_TABS: CategoryTab[] = [
  { label: '전체', value: 'all' },
  { label: '공동구매', value: 'group' },
  { label: '절화', value: 'cut_flower' },
  { label: '난', value: 'orchid' },
  { label: '관엽', value: 'foliage' },
];

export const COLOR_CHIPS: ColorChip[] = [
  { label: '레드', value: '레드', hex: '#E53E3E' },
  { label: '핑크', value: '핑크', hex: '#ED64A6' },
  { label: '연핑크', value: '연핑크', hex: '#FBB6CE' },
  { label: '로즈', value: '로즈', hex: '#C53030' },
  { label: '화이트', value: '화이트', hex: '#F7FAFC' },
  { label: '크림', value: '크림', hex: '#FFF5D6' },
  { label: '옐로우', value: '옐로우', hex: '#ECC94B' },
  { label: '골드', value: '골드', hex: '#D69E2E' },
  { label: '오렌지', value: '오렌지', hex: '#ED8936' },
  { label: '퍼플', value: '퍼플', hex: '#805AD5' },
  { label: '바이올렛', value: '바이올렛', hex: '#6B46C1' },
  { label: '연보라', value: '연보라', hex: '#D6BCFA' },
  { label: '블루', value: '블루', hex: '#4299E1' },
  { label: '그린', value: '그린', hex: '#48BB78' },
  { label: '무늬', value: '무늬', hex: '#B794F4' },
  { label: '브라운', value: '브라운', hex: '#975A16' },
  { label: '베이지', value: '베이지', hex: '#FEFCBF' },
  { label: '블랙', value: '블랙', hex: '#1A202C' },
  { label: '그레이', value: '그레이', hex: '#A0AEC0' },
];

export const SORT_CHOICES: SortChoice[] = [
  { label: '최신순', value: 'latest' },
  { label: '인기순', value: 'popular' },
  { label: '낮은가격순', value: 'price_asc' },
  { label: '높은가격순', value: 'price_desc' },
];

export const CATEGORY_VALUES: Category[] = ['cut_flower', 'orchid', 'foliage'];
export const COLOR_VALUES = COLOR_CHIPS.map((chip) => chip.value);
export const SORT_VALUES = SORT_CHOICES.map((choice) => choice.value);
export const SALE_TYPE_VALUES: SaleType[] = ['normal', 'group'];
