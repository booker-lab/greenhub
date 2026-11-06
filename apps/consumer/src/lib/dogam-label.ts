import type { Product } from '@greenhub/shared';
import { LIGHT_LABELS, PLACEMENT_LABELS } from '@greenhub/shared';

// 도감 라벨(design-direction.md §4.1): 상품 데이터에 이미 있는 값으로 만든 한 줄.
// 개화 상태 · 꽃대 종류 · 향 · 관리 난이도 · 높이 · 화분 지름 · 송이 수 · 빛 · 놓을 곳 순서이고 빈 칸은 건너뛴다.
// 한국어 표기는 상품 상세(ProductInfo.tsx)와 같은 표를 쓴다.

export const FRAGRANCE_LABEL: Record<string, string> = {
  none: '없음',
  light: '은은함',
  strong: '진함',
};
export const BLOOM_LABEL: Record<string, string> = {
  bud: '봉오리',
  half: '반개화',
  full: '활짝 핌',
};
export const CARE_LABEL: Record<string, string> = {
  easy: '쉬움',
  normal: '보통',
  hard: '어려움',
};

type DogamSource = Pick<Product, 'selection' | 'size' | 'light' | 'placements'>;

export function dogamLabelParts(product: DogamSource | undefined | null): string[] {
  if (!product) return [];
  const parts: string[] = [];
  const selection = product.selection;
  if (selection?.bloomCondition) {
    parts.push(BLOOM_LABEL[selection.bloomCondition] ?? selection.bloomCondition);
  }
  if (selection?.stemType) parts.push(selection.stemType);
  if (selection?.fragrance) {
    parts.push(`향 ${FRAGRANCE_LABEL[selection.fragrance] ?? selection.fragrance}`);
  }
  if (selection?.careLevel) {
    parts.push(`관리 ${CARE_LABEL[selection.careLevel] ?? selection.careLevel}`);
  }
  const size = product.size;
  if (size?.heightCm) parts.push(`높이 약 ${size.heightCm}cm`);
  if (size?.potDiameterCm) parts.push(`화분 지름 ${size.potDiameterCm}cm`);
  if (size?.bloomCount) parts.push(`약 ${size.bloomCount}송이`);
  if (product.light && LIGHT_LABELS[product.light]) parts.push(LIGHT_LABELS[product.light]);
  const places = (product.placements ?? [])
    .map((place) => PLACEMENT_LABELS[place])
    .filter(Boolean);
  if (places.length > 0) parts.push(places.join(', '));
  return parts;
}

/** "봉오리 · 쌍대 · 높이 약 60cm". 값이 하나도 없으면 빈 문자열. */
export function dogamLabel(product: DogamSource | undefined | null): string {
  return dogamLabelParts(product).join(' · ');
}
