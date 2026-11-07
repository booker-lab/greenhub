import {
  FLOWER_MARKET_GUBN_LABELS,
  FLOWER_MARKET_GUBNS,
  type FlowerMarketGubn,
  MARKET_NAME_MAX_LENGTH,
  MARKET_UNITS_PER_ITEM_MAX,
  type MarketPriceSummary,
  type ProductMarketRef,
} from '@greenhub/shared';

// 경매 시세(aT 화훼공판장 경락가격) 판매자 화면 계산. 서버가 준 시세를 그대로 쓰고 여기서는 보여 줄 값만 만든다.

/** aT 화훼유통정보 OpenAPI 이용허락(제작자 표시) — 시세를 보여 주는 곳마다 붙인다. */
export const MARKET_PRICE_SOURCE = '출처: aT 화훼유통정보';

/** 상품 편집의 시세 연결 칸. flowerGubn이 빈 문자열이면 연결하지 않는다. */
export interface MarketRefForm {
  flowerGubn: '' | `${FlowerMarketGubn}`;
  pumName: string;
  goodName: string;
  grade: string;
  unitsPerItem: string;
}

export function defaultMarketRefForm(): MarketRefForm {
  return { flowerGubn: '', pumName: '', goodName: '', grade: '', unitsPerItem: '1' };
}

export function marketRefFormFromProduct(value: unknown): MarketRefForm {
  const ref = value as Partial<ProductMarketRef> | null | undefined;
  if (!ref || !(FLOWER_MARKET_GUBNS as readonly unknown[]).includes(ref.flowerGubn) || typeof ref.pumName !== 'string') {
    return defaultMarketRefForm();
  }
  return {
    flowerGubn: String(ref.flowerGubn) as MarketRefForm['flowerGubn'],
    pumName: ref.pumName,
    goodName: typeof ref.goodName === 'string' ? ref.goodName : '',
    grade: typeof ref.grade === 'string' ? ref.grade : '',
    unitsPerItem: typeof ref.unitsPerItem === 'number' ? String(ref.unitsPerItem) : '1',
  };
}

const UNITS_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

/**
 * 저장 본문. 부류를 고르지 않으면 null(연결 지우기)이다.
 * 부류를 골랐으면 품목 이름과 상품 1개당 단위 수가 있어야 한다.
 */
export function marketRefBody(
  form: MarketRefForm,
): { ok: true; body: ProductMarketRef | null } | { ok: false; error: string } {
  if (form.flowerGubn === '') return { ok: true, body: null };
  const pumName = form.pumName.trim();
  const goodName = form.goodName.trim();
  const grade = form.grade.trim();
  if (!pumName) return { ok: false, error: '경매 시세를 연결하려면 품목 이름을 넣어 주세요.' };
  if ([pumName, goodName, grade].some((name) => name.length > MARKET_NAME_MAX_LENGTH)) {
    return { ok: false, error: `경매 품목·품종·등급 이름은 ${MARKET_NAME_MAX_LENGTH}자까지예요.` };
  }
  const units = form.unitsPerItem.trim();
  const unitsPerItem = Number(units);
  if (!UNITS_PATTERN.test(units) || !(unitsPerItem > 0) || unitsPerItem > MARKET_UNITS_PER_ITEM_MAX) {
    return {
      ok: false,
      error: `상품 1개에 드는 경매 단위 수는 0보다 크고 ${MARKET_UNITS_PER_ITEM_MAX} 이하로, 소수 둘째 자리까지 넣어 주세요.`,
    };
  }
  return {
    ok: true,
    body: {
      flowerGubn: Number(form.flowerGubn) as FlowerMarketGubn,
      pumName,
      ...(goodName ? { goodName } : {}),
      ...(grade ? { grade } : {}),
      unitsPerItem,
    },
  };
}

/** 저장 전 미리 보기 쿼리. 미리 볼 수 없는 상태면 null. */
export function marketLookupQuery(form: MarketRefForm): string | null {
  const result = marketRefBody(form);
  if (!result.ok || !result.body) return null;
  const { flowerGubn, pumName, goodName, grade, unitsPerItem } = result.body;
  const params = new URLSearchParams({ flowerGubn: String(flowerGubn), pumName });
  if (goodName) params.set('goodName', goodName);
  if (grade) params.set('grade', grade);
  params.set('unitsPerItem', String(unitsPerItem));
  return params.toString();
}

/** 절화는 1속, 나머지(분화)는 1분이 경매 단가 기준이다. */
export function marketUnitLabel(flowerGubn: FlowerMarketGubn | '' | `${FlowerMarketGubn}`): string {
  return String(flowerGubn) === '1' ? '속' : '분';
}

export function marketRefLabel(ref: ProductMarketRef): string {
  return [
    FLOWER_MARKET_GUBN_LABELS[ref.flowerGubn],
    ref.pumName,
    ref.goodName ?? '전체 품종',
    ref.grade ?? '전체 등급',
  ].join(' · ');
}

function won(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function monthDay(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  return `${Number(month)}/${Number(day)}`;
}

/** 상품 1개 기준 경매 매입가(원). 최근 4주 평균을 먼저 쓰고, 없으면 마지막 경매일 값을 쓴다. */
export function expectedUnitCost(summary: MarketPriceSummary | null | undefined): number | null {
  return summary?.unitCost.recentAvg ?? summary?.unitCost.latest ?? null;
}

/** 시세 한 줄 요약. 거래가 없으면 그 사실을 알린다. */
export function marketSummaryLines(summary: MarketPriceSummary): string[] {
  const unit = marketUnitLabel(summary.ref.flowerGubn);
  const units = summary.ref.unitsPerItem;
  const lines: string[] = [];
  if (summary.recent) {
    lines.push(
      `최근 4주 평균 ${won(summary.recent.avg)}/${unit} (경매 ${summary.recent.auctionDays}일, ${won(summary.recent.min)}~${won(summary.recent.max)})`,
    );
  }
  if (summary.latest) {
    lines.push(`마지막 경매 ${monthDay(summary.latest.saleDate)} 평균 ${won(summary.latest.avg)}/${unit}`);
  }
  const cost = expectedUnitCost(summary);
  if (cost !== null) {
    lines.push(`상품 1개 예상 매입가 ${won(cost)}${units === 1 ? '' : ` (${units}${unit} 기준)`}`);
  }
  if (lines.length === 0) lines.push('아직 이 조건으로 수집된 경매 시세가 없어요.');
  return lines;
}

export type RoundPriceCheck =
  | { kind: 'none' }
  | { kind: 'below'; cost: number; diff: number }
  | { kind: 'margin'; cost: number; diff: number; rate: number };

/** 회차 가격과 예상 매입가 비교. 매입가보다 낮으면 경고한다. */
export function checkRoundPrice(
  roundPrice: number | null,
  summary: MarketPriceSummary | null | undefined,
): RoundPriceCheck {
  const cost = expectedUnitCost(summary);
  if (cost === null || roundPrice === null || !Number.isFinite(roundPrice) || roundPrice <= 0) {
    return { kind: 'none' };
  }
  const diff = roundPrice - cost;
  if (diff < 0) return { kind: 'below', cost, diff };
  return { kind: 'margin', cost, diff, rate: Math.round((diff / roundPrice) * 100) };
}

export function roundPriceCheckText(check: RoundPriceCheck): string | null {
  if (check.kind === 'none') return null;
  if (check.kind === 'below') {
    return `예상 매입가 ${won(check.cost)}보다 ${won(-check.diff)} 낮아요. 경매가가 그대로면 팔수록 손해예요.`;
  }
  return `예상 매입가 ${won(check.cost)} · 차액 ${won(check.diff)} (${check.rate}%)`;
}

export interface PurchaseEstimateLine {
  productId: string;
  quantity: number;
  unitCost: number | null;
  cost: number | null;
}

/** 구매 목록 상품별 예상 매입액. 시세를 모르는 상품은 합계에서 빼고 따로 센다. */
export function estimatePurchase(
  lines: ReadonlyArray<{ productId: string; quantity: number }>,
  summaries: Readonly<Record<string, MarketPriceSummary | null>>,
): { lines: PurchaseEstimateLine[]; total: number; unknownCount: number } {
  const estimated = lines.map((line) => {
    const unitCost = expectedUnitCost(summaries[line.productId]);
    return {
      productId: line.productId,
      quantity: line.quantity,
      unitCost,
      cost: unitCost === null ? null : unitCost * line.quantity,
    };
  });
  return {
    lines: estimated,
    total: estimated.reduce((sum, line) => sum + (line.cost ?? 0), 0),
    unknownCount: estimated.filter((line) => line.cost === null && line.quantity > 0).length,
  };
}

export function formatWon(value: number): string {
  return won(value);
}
