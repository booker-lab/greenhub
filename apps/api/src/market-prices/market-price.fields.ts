import { createHash } from 'node:crypto';
import {
  FLOWER_MARKET_GUBNS,
  type FlowerMarketGubn,
  MARKET_RECENT_DAYS,
  type MarketPriceStat,
  type MarketPriceSummary,
  type ProductMarketRef,
} from '@greenhub/shared';

// 화훼 경매 시세 저장 모양과 계산. 클라이언트 직접 접근은 firestore.rules 기본 거부(서버 전용).
//
// marketPriceSeries/{seriesId}: 부류·품목·품종 하나의 일별·등급별 시세 묶음(points).
//   하루 수집이 문서 하나를 한 번 고치므로 복합 색인 없이 문서 id로 바로 읽는다.
// marketPriceCatalog/{flowerGubn}: 부류별로 지금까지 수집된 품목·품종 이름(연결 칸 고르기용).
export const MARKET_PRICE_SERIES_COLLECTION = 'marketPriceSeries';
export const MARKET_PRICE_CATALOG_COLLECTION = 'marketPriceCatalog';

/** 시세 묶음에 남기는 기간(일). 작년 같은 주 비교(2단계)를 위해 1년보다 조금 길게 둔다. */
export const MARKET_POINT_RETENTION_DAYS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 하루·등급 하나의 시세. amt는 총 거래금액(물량 가중 평균을 다시 내는 데 쓴다). */
export interface MarketPricePoint {
  d: string;
  g: string;
  avg: number;
  min: number;
  max: number;
  qty: number;
  amt: number;
}

/** 경매 결과 한 줄(수집 원본을 정규화한 것). */
export interface MarketAuctionRow {
  saleDate: string;
  flowerGubn: FlowerMarketGubn;
  pumName: string;
  goodName: string;
  grade: string;
  avg: number;
  min: number;
  max: number;
  qty: number;
  amt: number;
}

export function isFlowerMarketGubn(value: unknown): value is FlowerMarketGubn {
  return (FLOWER_MARKET_GUBNS as readonly unknown[]).includes(value);
}

/** 부류·품목·품종으로 정한 문서 id. 이름에 '/' 등이 있어도 안전하게 해시로 만든다. */
export function marketSeriesId(flowerGubn: FlowerMarketGubn, pumName: string, goodName: string): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([flowerGubn, pumName, goodName]))
    .digest('hex')
    .slice(0, 32);
  return `${flowerGubn}_${digest}`;
}

export function shiftIsoDate(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * 같은 날·같은 등급 줄이 여러 개면(산지·규격이 달라 나뉜 경우) 물량 가중으로 하나로 합친다.
 */
function combine(points: ReadonlyArray<Omit<MarketPricePoint, 'd' | 'g'>>): MarketPriceStat & { amt: number } {
  const qty = points.reduce((sum, point) => sum + point.qty, 0);
  const amt = points.reduce((sum, point) => sum + point.amt, 0);
  return {
    avg: qty > 0 ? Math.round(amt / qty) : 0,
    min: Math.min(...points.map((point) => point.min)),
    max: Math.max(...points.map((point) => point.max)),
    qty,
    amt,
  };
}

/** 수집한 줄을 시세 묶음별 points로 모은다. */
export function groupRowsBySeries(rows: readonly MarketAuctionRow[]) {
  const series = new Map<
    string,
    { flowerGubn: FlowerMarketGubn; pumName: string; goodName: string; points: Map<string, MarketAuctionRow[]> }
  >();
  for (const row of rows) {
    const id = marketSeriesId(row.flowerGubn, row.pumName, row.goodName);
    const entry =
      series.get(id) ??
      { flowerGubn: row.flowerGubn, pumName: row.pumName, goodName: row.goodName, points: new Map() };
    series.set(id, entry);
    const key = `${row.saleDate}|${row.grade}`;
    entry.points.set(key, [...(entry.points.get(key) ?? []), row]);
  }
  return [...series.entries()].map(([id, entry]) => ({
    id,
    flowerGubn: entry.flowerGubn,
    pumName: entry.pumName,
    goodName: entry.goodName,
    points: [...entry.points.values()].map((same) => ({
      d: same[0].saleDate,
      g: same[0].grade,
      ...combine(same),
    })),
  }));
}

function toPoint(value: unknown): MarketPricePoint | null {
  const p = value as Partial<MarketPricePoint> | null;
  const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (
    !p ||
    typeof p.d !== 'string' ||
    !ISO_DATE_PATTERN.test(p.d) ||
    typeof p.g !== 'string' ||
    ![p.avg, p.min, p.max, p.qty, p.amt].every(num)
  ) {
    return null;
  }
  return { d: p.d, g: p.g, avg: p.avg!, min: p.min!, max: p.max!, qty: p.qty!, amt: p.amt! };
}

export function readSeriesPoints(data: Record<string, unknown> | undefined): MarketPricePoint[] {
  const raw = data?.['points'];
  return Array.isArray(raw) ? raw.map(toPoint).filter((p): p is MarketPricePoint => p !== null) : [];
}

/**
 * 저장된 points에 새로 받은 points를 더한다. 같은 날·같은 등급은 새 값으로 바꾸고(다시 수집해도 같은 결과),
 * oldestKeep보다 오래된 날은 지운다.
 */
export function mergeSeriesPoints(
  existing: readonly MarketPricePoint[],
  incoming: readonly MarketPricePoint[],
  oldestKeep: string,
): MarketPricePoint[] {
  const byKey = new Map<string, MarketPricePoint>();
  for (const point of [...existing, ...incoming]) byKey.set(`${point.d}|${point.g}`, point);
  return [...byKey.values()]
    .filter((point) => point.d >= oldestKeep)
    .sort((a, b) => (a.d === b.d ? a.g.localeCompare(b.g, 'ko') : a.d < b.d ? -1 : 1));
}

/**
 * 연결 조건(등급)에 맞는 points로 최근 경매일·최근 4주 시세와 상품 1개 기준 예상 매입가를 낸다.
 * today는 서울 기준 날짜(YYYY-MM-DD)다.
 */
export function summarizeMarketPoints(
  points: readonly MarketPricePoint[],
  ref: ProductMarketRef,
  today: string,
): MarketPriceSummary {
  const grades = [...new Set(points.map((point) => point.g))].sort((a, b) => a.localeCompare(b, 'ko'));
  const matching = ref.grade ? points.filter((point) => point.g === ref.grade) : points;

  const byDate = new Map<string, MarketPricePoint[]>();
  for (const point of matching) byDate.set(point.d, [...(byDate.get(point.d) ?? []), point]);
  const days = [...byDate.entries()]
    .map(([d, same]) => ({ d, ...combine(same) }))
    .filter((day) => day.qty > 0)
    .sort((a, b) => (a.d < b.d ? -1 : 1));

  const last = days.at(-1);
  const from = shiftIsoDate(today, -(MARKET_RECENT_DAYS - 1));
  const window = days.filter((day) => day.d >= from && day.d <= today);
  const recentStat = window.length > 0 ? combine(window) : null;

  const unit = (avg: number | undefined) =>
    avg === undefined ? null : Math.round(avg * ref.unitsPerItem);

  return {
    ref,
    latest: last
      ? { saleDate: last.d, avg: last.avg, min: last.min, max: last.max, qty: last.qty }
      : null,
    recent: recentStat
      ? {
          from: window[0].d,
          to: window.at(-1)!.d,
          auctionDays: window.length,
          avg: recentStat.avg,
          min: recentStat.min,
          max: recentStat.max,
          qty: recentStat.qty,
        }
      : null,
    unitCost: { latest: unit(last?.avg), recentAvg: unit(recentStat?.avg) },
    grades,
  };
}

/** 저장된 상품의 marketRef를 읽는다. 모양이 틀리면 연결이 없는 것으로 본다. */
export function readProductMarketRef(value: unknown): ProductMarketRef | null {
  const ref = value as Partial<ProductMarketRef> | null | undefined;
  if (
    !ref ||
    !isFlowerMarketGubn(ref.flowerGubn) ||
    typeof ref.pumName !== 'string' ||
    ref.pumName.trim() === '' ||
    typeof ref.unitsPerItem !== 'number' ||
    !(ref.unitsPerItem > 0)
  ) {
    return null;
  }
  return {
    flowerGubn: ref.flowerGubn,
    pumName: ref.pumName,
    ...(typeof ref.goodName === 'string' && ref.goodName !== '' ? { goodName: ref.goodName } : {}),
    ...(typeof ref.grade === 'string' && ref.grade !== '' ? { grade: ref.grade } : {}),
    unitsPerItem: ref.unitsPerItem,
  };
}
