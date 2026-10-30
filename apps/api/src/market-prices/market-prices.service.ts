import {
  FLOWER_MARKET_GUBNS,
  type FlowerMarketGubn,
  type MarketCatalog,
  type MarketPriceSummary,
  type ProductMarketRef,
} from '@greenhub/shared';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { acquireJobLease, completeJobLease, seoulDailySlotKey } from '../common/job-lease';
import { assertStoreOwnerOrAdmin } from '../common/store-ownership';
import { FirestoreService } from '../firestore/firestore.service';
import { FlowerAuctionClient } from './flower-auction.client';
import {
  MARKET_POINT_RETENTION_DAYS,
  MARKET_PRICE_CATALOG_COLLECTION,
  MARKET_PRICE_SERIES_COLLECTION,
  type MarketAuctionRow,
  type MarketPricePoint,
  groupRowsBySeries,
  marketSeriesId,
  mergeSeriesPoints,
  readProductMarketRef,
  readSeriesPoints,
  shiftIsoDate,
  summarizeMarketPoints,
} from './market-price.fields';

export const MARKET_PRICES_INGEST_JOB_NAME = 'market-prices-ingest';
/** 늦게 올라온 결과·하루 거른 수집을 메우려고 오늘 포함 최근 며칠을 다시 받는다(같은 날은 덮어쓴다). */
export const MARKET_PRICES_LOOKBACK_DAYS = 3;
const INGEST_LEASE_TTL_MS = 10 * 60 * 1000;
/** 시세 묶음 문서를 동시에 고치는 수. Cloud Run 요청 시간(60초) 안에 끝나게 한다. */
const SERIES_WRITE_CONCURRENCY = 16;
const SUMMARY_PRODUCTS_MAX = 50;

export type MarketPricesIngestResult =
  | { status: 'NOT_CONFIGURED' }
  | { status: 'DONE'; dates: string[]; rows: number; series: number; failures: string[] };

async function inPool<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  });
  await Promise.all(workers);
}

/**
 * aT 화훼공판장 경락가격을 매일 받아 시세 묶음으로 저장하고, 판매자 화면에 상품별 시세를 돌려준다.
 * 인증키(FLOWER_AUCTION_API_KEY)가 없으면 수집하지 않는다(조회는 저장된 만큼만 보여 준다).
 */
@Injectable()
export class MarketPricesService {
  private readonly logger = new Logger(MarketPricesService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly client: FlowerAuctionClient,
  ) {}

  // 경매 결과가 그날 저녁까지 올라오므로 밤에 받는다. 다른 작업과 겹치지 않는 시각.
  @Cron('10 21 * * *', { timeZone: 'Asia/Seoul' })
  async runScheduledIngest(): Promise<void> {
    if (!this.client.configured) {
      this.logger.warn('[MarketPrices] FLOWER_AUCTION_API_KEY가 없어 경매 시세 수집을 건너뜁니다.');
      return;
    }
    const now = new Date();
    const acquired = await acquireJobLease(this.firestore, {
      jobName: MARKET_PRICES_INGEST_JOB_NAME,
      slotKey: seoulDailySlotKey(now),
      ttlMs: INGEST_LEASE_TTL_MS,
      logger: this.logger,
    });
    if (acquired.status !== 'ACQUIRED') return;
    // 일부라도 못 받으면 회차를 완료로 남기지 않아 같은 날 다시 돌 수 있게 한다.
    let succeeded = false;
    try {
      const result = await this.ingest(now);
      this.logger.log(`[MarketPrices] ${JSON.stringify(result)}`);
      succeeded = result.status === 'DONE' && result.failures.length === 0;
    } catch (error) {
      this.logger.error(
        `[MarketPrices] 경매 시세 저장 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await completeJobLease(this.firestore, acquired.lease, { succeeded, logger: this.logger });
  }

  /**
   * 최근 며칠·모든 부류를 받아 저장한다. 받은 만큼은 저장하고, 실패한 날·부류는 failures에 남긴다.
   */
  async ingest(now: Date = new Date()): Promise<MarketPricesIngestResult> {
    if (!this.client.configured) return { status: 'NOT_CONFIGURED' };
    const today = seoulDailySlotKey(now);
    const dates = Array.from({ length: MARKET_PRICES_LOOKBACK_DAYS }, (_, i) => shiftIsoDate(today, -i));
    const requests = dates.flatMap((date) => FLOWER_MARKET_GUBNS.map((gubn) => ({ date, gubn })));

    const settled = await Promise.allSettled(
      requests.map(({ date, gubn }) => this.client.fetchDay(date, gubn)),
    );
    const rows: MarketAuctionRow[] = [];
    const failures: string[] = [];
    settled.forEach((result, index) => {
      const { date, gubn } = requests[index];
      if (result.status === 'fulfilled') rows.push(...result.value);
      else {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failures.push(`${date}/${gubn}: ${reason}`);
        this.logger.error(`[MarketPrices] ${date} 부류 ${gubn} 수집 실패: ${reason}`);
      }
    });

    const series = groupRowsBySeries(rows);
    const oldestKeep = shiftIsoDate(today, -MARKET_POINT_RETENTION_DAYS);
    const updatedAt = now.toISOString();
    await inPool(series, SERIES_WRITE_CONCURRENCY, async (entry) => {
      const ref = this.firestore.doc(`${MARKET_PRICE_SERIES_COLLECTION}/${entry.id}`);
      await this.firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const existing = snap.exists ? readSeriesPoints(snap.data()) : [];
        tx.set(ref, {
          flowerGubn: entry.flowerGubn,
          pumName: entry.pumName,
          goodName: entry.goodName,
          points: mergeSeriesPoints(existing, entry.points, oldestKeep),
          updatedAt,
        });
      });
    });
    for (const gubn of FLOWER_MARKET_GUBNS) {
      const names = series.filter((entry) => entry.flowerGubn === gubn);
      if (names.length > 0) await this.mergeCatalog(gubn, names, updatedAt);
    }

    return { status: 'DONE', dates, rows: rows.length, series: series.length, failures };
  }

  private async mergeCatalog(
    gubn: FlowerMarketGubn,
    names: ReadonlyArray<{ pumName: string; goodName: string }>,
    updatedAt: string,
  ) {
    const ref = this.firestore.doc(`${MARKET_PRICE_CATALOG_COLLECTION}/${gubn}`);
    await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const byPum = new Map<string, Set<string>>();
      for (const item of readCatalogItems(snap.exists ? snap.data() : undefined)) {
        byPum.set(item.pumName, new Set(item.goodNames));
      }
      for (const { pumName, goodName } of names) {
        byPum.set(pumName, (byPum.get(pumName) ?? new Set()).add(goodName));
      }
      tx.set(ref, { flowerGubn: gubn, items: sortCatalog(byPum), updatedAt });
    });
  }

  // ── 판매자 조회 ─────────────────────────────────────────────

  async catalog(storeId: string, userId: string, role: string, gubn: FlowerMarketGubn): Promise<MarketCatalog> {
    await assertStoreOwnerOrAdmin(this.firestore, storeId, userId, role);
    const snap = await this.firestore.doc(`${MARKET_PRICE_CATALOG_COLLECTION}/${gubn}`).get();
    const data = snap.exists ? snap.data() : undefined;
    return {
      flowerGubn: gubn,
      items: readCatalogItems(data),
      updatedAt: typeof data?.['updatedAt'] === 'string' ? data['updatedAt'] : null,
    };
  }

  /** 저장 전 연결 조건 미리 보기(상품 편집 화면). */
  async lookup(storeId: string, userId: string, role: string, ref: ProductMarketRef): Promise<MarketPriceSummary> {
    await assertStoreOwnerOrAdmin(this.firestore, storeId, userId, role);
    return this.summarize(ref, new Date());
  }

  /** 이 가게 상품들의 시세. 연결이 없거나 다른 가게 상품이면 null이다. */
  async summaries(
    storeId: string,
    userId: string,
    role: string,
    productIds: readonly string[],
  ): Promise<{ summaries: Record<string, MarketPriceSummary | null> }> {
    await assertStoreOwnerOrAdmin(this.firestore, storeId, userId, role);
    const ids = [...new Set(productIds)].slice(0, SUMMARY_PRODUCTS_MAX);
    const now = new Date();
    const entries = await Promise.all(
      ids.map(async (productId) => {
        const snap = await this.firestore.doc(`products/${productId}`).get();
        const data = snap.exists ? snap.data() : undefined;
        const ref = data?.['storeId'] === storeId ? readProductMarketRef(data['marketRef']) : null;
        return [productId, ref ? await this.summarize(ref, now) : null] as const;
      }),
    );
    return { summaries: Object.fromEntries(entries) };
  }

  private async summarize(ref: ProductMarketRef, now: Date): Promise<MarketPriceSummary> {
    let points: MarketPricePoint[];
    if (ref.goodName) {
      const snap = await this.firestore
        .doc(`${MARKET_PRICE_SERIES_COLLECTION}/${marketSeriesId(ref.flowerGubn, ref.pumName, ref.goodName)}`)
        .get();
      points = snap.exists ? readSeriesPoints(snap.data()) : [];
    } else {
      // 품종을 정하지 않으면 품목의 모든 품종을 합친다(동등 조건 두 개라 단일 필드 색인으로 충분하다).
      const snap = await this.firestore
        .collection(MARKET_PRICE_SERIES_COLLECTION)
        .where('flowerGubn', '==', ref.flowerGubn)
        .where('pumName', '==', ref.pumName)
        .get();
      points = snap.docs.flatMap((doc) => readSeriesPoints(doc.data()));
    }
    return summarizeMarketPoints(points, ref, seoulDailySlotKey(now));
  }
}

function readCatalogItems(data: Record<string, unknown> | undefined): MarketCatalog['items'] {
  const raw = data?.['items'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is { pumName: string; goodNames: unknown[] } =>
        typeof item?.pumName === 'string' && Array.isArray(item?.goodNames),
    )
    .map((item) => ({
      pumName: item.pumName,
      goodNames: item.goodNames.filter((name): name is string => typeof name === 'string'),
    }));
}

function sortCatalog(byPum: Map<string, Set<string>>): MarketCatalog['items'] {
  const ko = (a: string, b: string) => a.localeCompare(b, 'ko');
  return [...byPum.entries()]
    .sort(([a], [b]) => ko(a, b))
    .map(([pumName, goods]) => ({ pumName, goodNames: [...goods].sort(ko) }));
}
