import type { ProductSize } from '@greenhub/shared';

// 팔도감 벤치마킹 비교 기능의 표시용 계산. 다른 모듈을 불러오지 않아 테스트가 그대로 실행한다.

/**
 * 지난 회차보다 내린 금액(원). 지금 가격이 직전 마감 회차 가격보다 낮을 때만 양수를 돌려주고,
 * 같거나 높거나 근거(previousRoundPrice)가 없으면 null.
 */
export function priceDropFromPreviousRound(
  previousRoundPrice: number | undefined,
  price: number,
): number | null {
  if (typeof previousRoundPrice !== 'number' || !Number.isFinite(previousRoundPrice)) return null;
  if (!Number.isFinite(price) || price < 0) return null;
  const drop = previousRoundPrice - price;
  return drop > 0 ? drop : null;
}

/** "지난 회차보다 3,000원 내렸어요". 천 단위 콤마는 실행 환경 locale과 무관하게 직접 넣는다. */
export function previousRoundDropLabel(drop: number): string {
  const amount = String(Math.trunc(drop)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `지난 회차보다 ${amount}원 내렸어요`;
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
  // 관엽·화훼. 짧은 영어 이름(rose 등)은 다른 이름 안에 들어가(로즈마리) 엉뚱한 상품을 찾으므로 넣지 않는다.
  ['금전수', '돈나무', '자미오쿨카스', 'zamioculcas', 'zz플랜트', 'zz plant'],
  ['몬스테라', '몬스테라 델리시오사', 'monstera'],
  ['산세베리아', '산세비에리아', '스투키', 'sansevieria'],
  ['행운목', '드라세나 맛상게아나', '맛상게아나', 'massangeana'],
  ['고무나무', '인도고무나무', '피쿠스 엘라스티카', 'ficus elastica'],
  ['장미', '장미꽃', '미니장미'],
  ['수국', '하이드레인지아', 'hydrangea'],
  ['튤립', 'tulip'],
  ['카네이션', 'carnation'],
  ['거베라', 'gerbera'],
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
