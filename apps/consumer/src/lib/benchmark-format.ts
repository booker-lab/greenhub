import type { ProductSize } from '@greenhub/shared';

// 팔도감 벤치마킹 비교 기능의 표시용 계산. 다른 모듈을 불러오지 않아 테스트가 그대로 실행한다.

/** 정상가 대비 할인율(%). 정상가가 없거나 회차 가격보다 낮으면 null. 1% 미만은 표시하지 않는다. */
export function discountRate(listPrice: number | undefined, price: number): number | null {
  if (!listPrice || !Number.isFinite(listPrice) || listPrice <= price || price < 0) return null;
  const rate = Math.floor(((listPrice - price) / listPrice) * 100);
  return rate >= 1 ? rate : null;
}

/** 상세 크기 표 행. */
export function sizeRows(size: ProductSize | undefined): Array<[string, string]> {
  if (!size) return [];
  const rows: Array<[string, string]> = [];
  if (size.heightCm) rows.push(['높이', `${size.heightCm}cm`]);
  if (size.widthCm) rows.push(['폭', `${size.widthCm}cm`]);
  if (size.potDiameterCm) rows.push(['화분 지름', `${size.potDiameterCm}cm`]);
  if (size.bloomCount) rows.push(['꽃 송이', `약 ${size.bloomCount}송이`]);
  return rows;
}

// ── 식물 이름 검색(plant-search) ──

/** 같은 꽃을 부르는 다른 이름. 왼쪽 이름으로 검색해도 오른쪽 이름이 들어간 상품을 찾는다. */
export const PLANT_SYNONYMS: ReadonlyArray<readonly string[]> = [
  ['호접란', '팔레놉시스', 'phalaenopsis', '나비난', '서양란'],
  ['동양란', '춘란', '한란', '보세란'],
  ['덴드로비움', 'dendrobium', '석곡'],
  ['심비디움', 'cymbidium'],
  ['만천홍', '빨간 호접란', '붉은 호접란'],
  ['빅립', 'big lip', '빅 립'],
];

export function normalizeSearchText(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/\s+/g, '');
}

/** 검색어를 같은 꽃의 다른 이름까지 넓힌다. */
export function expandPlantQuery(query: string): string[] {
  const q = normalizeSearchText(query);
  if (!q) return [];
  const terms = new Set<string>([q]);
  for (const group of PLANT_SYNONYMS) {
    const names = group.map(normalizeSearchText);
    if (names.some((name) => name.includes(q) || q.includes(name))) {
      for (const name of names) terms.add(name);
    }
  }
  return [...terms];
}

/** 상품 이름·설명·별칭 가운데 하나라도 넓힌 검색어를 담고 있으면 true. */
export function matchesPlantQuery(
  query: string,
  fields: ReadonlyArray<string | null | undefined>,
): boolean {
  const terms = expandPlantQuery(query);
  if (terms.length === 0) return false;
  const haystack = fields.filter(Boolean).map((field) => normalizeSearchText(String(field)));
  return terms.some((term) => haystack.some((text) => text.includes(term)));
}
