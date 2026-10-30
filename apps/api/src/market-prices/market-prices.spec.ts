// 화훼 경매 시세: aT 응답 정규화(형식이 다르면 실패), 시세 묶음 저장·재수집, 판매자 조회 경계를 증명한다.
// HTTP는 실제 JWT 인증·역할 가드·전역 ValidationPipe를 띄우고, 저장은 in-memory Firestore에 실제로 쓴다.

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createInMemoryFirestore } from '../../test/helpers/in-memory-firestore';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { JOB_LEASE_COLLECTION } from '../common/job-lease';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { FirestoreService } from '../firestore/firestore.service';
import { UpdateProductDto } from '../products/dto/update-product.dto';
import {
  FLOWER_AUCTION_FETCH,
  FLOWER_AUCTION_PAGE_SIZE,
  FlowerAuctionClient,
  type FlowerAuctionFetch,
  FlowerAuctionResponseError,
  parseFlowerAuctionResponse,
} from './flower-auction.client';
import {
  type MarketPricePoint,
  groupRowsBySeries,
  marketSeriesId,
  mergeSeriesPoints,
  summarizeMarketPoints,
} from './market-price.fields';
import { MarketPricesController } from './market-prices.controller';
import { MARKET_PRICES_INGEST_JOB_NAME, MarketPricesService } from './market-prices.service';

const JWT_SECRET = 'market-prices-test-secret';
const API_KEY = 'secret-service-key-123';
// 2026-10-27(화) 12:00 UTC = 21:00 KST. 수집 날짜는 10-27·10-26·10-25.
const NOW = new Date('2026-10-27T12:00:00.000Z');

type Actor = 'admin' | 'seller' | 'otherSeller' | 'consumer';
const ACTORS: Record<Actor, { sub: string; role: string; storeId: string | null }> = {
  admin: { sub: 'admin-1', role: 'admin', storeId: null },
  seller: { sub: 'seller-1', role: 'seller', storeId: 'store-1' },
  otherSeller: { sub: 'seller-2', role: 'seller', storeId: 'store-2' },
  consumer: { sub: 'consumer-1', role: 'consumer', storeId: null },
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    saleDate: '2026-10-26',
    flowerGubn: '3',
    pumName: '호접란',
    goodName: '만천홍',
    lvNm: '특',
    maxAmt: '15,000',
    minAmt: '9000',
    avgAmt: 12000,
    totAmt: 120000,
    totQty: 10,
    ...overrides,
  };
}

const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

describe('aT 경락가격 응답 정규화', () => {
  it('숫자 문자열·쉼표를 읽고 거래 없는 줄은 건너뛴다', () => {
    const rows = parseFlowerAuctionResponse(
      { response: { resultCd: '0', items: [row(), row({ lvNm: '상', totQty: '0', avgAmt: '0' })] } },
      '2026-10-26',
      3,
    );
    expect(rows).toEqual([
      {
        saleDate: '2026-10-26',
        flowerGubn: 3,
        pumName: '호접란',
        goodName: '만천홍',
        grade: '특',
        avg: 12000,
        min: 9000,
        max: 15000,
        qty: 10,
        amt: 120000,
      },
    ]);
  });

  it('경매일을 YYYYMMDD로 줘도 읽고, 경매일·총금액이 없으면 요청한 날·평균×물량을 쓴다', () => {
    expect(
      parseFlowerAuctionResponse({ response: { items: { item: [row({ saleDate: '20261026' })] } } }, '2026-10-26', 3),
    ).toHaveLength(1);
    const [only] = parseFlowerAuctionResponse(
      { items: [row({ saleDate: undefined, totAmt: undefined })] },
      '2026-10-26',
      3,
    );
    expect(only).toEqual(expect.objectContaining({ saleDate: '2026-10-26', amt: 120000 }));
  });

  it('경매가 없는 날(빈 목록)은 빈 결과다', () => {
    expect(parseFlowerAuctionResponse({ response: { items: [] } }, '2026-10-25', 1)).toEqual([]);
  });

  it.each([
    ['목록을 찾지 못함', { response: { data: [] } }, '목록을 찾지 못했습니다'],
    ['결과 코드 오류', { response: { resultCd: '99', items: [] } }, '결과 코드'],
    ['항목 이름이 달라 하나도 못 읽음', { response: { items: [{ PUM_NM: '호접란', AVG: 1 }] } }, '하나도 읽지 못했습니다'],
    ['다른 날 결과가 섞임', { response: { items: [row({ saleDate: '2026-10-19' })] } }, '다른 경매일'],
    [
      '한 번에 꽉 차게 와서 잘렸을 수 있음',
      { response: { items: Array.from({ length: FLOWER_AUCTION_PAGE_SIZE }, () => row()) } },
      '잘렸을 수',
    ],
  ])('%s → 저장하지 않고 실패한다', (_label, body, message) => {
    expect(() => parseFlowerAuctionResponse(body, '2026-10-26', 3)).toThrow(FlowerAuctionResponseError);
    expect(() => parseFlowerAuctionResponse(body, '2026-10-26', 3)).toThrow(message);
  });

  it('요청 변수를 붙여 부르고, 실패 메시지에 인증키를 남기지 않는다', async () => {
    const calls: string[] = [];
    const fetcher: FlowerAuctionFetch = async (url) => {
      calls.push(url);
      return { ok: false, status: 500, text: async () => '' };
    };
    const client = new FlowerAuctionClient(new ConfigService({ FLOWER_AUCTION_API_KEY: API_KEY }), fetcher);
    const error = await client.fetchDay('2026-10-26', 3).catch((e: Error) => e);
    expect(error).toBeInstanceOf(FlowerAuctionResponseError);
    expect((error as Error).message).not.toContain(API_KEY);
    const url = new URL(calls[0]);
    expect(`${url.origin}${url.pathname}`).toBe('https://flower.at.or.kr/api/returnData.api');
    expect(Object.fromEntries(url.searchParams)).toEqual(
      expect.objectContaining({ kind: 'f001', serviceKey: API_KEY, baseDate: '2026-10-26', flowerGubn: '3', dataType: 'json' }),
    );
  });

  it('JSON이 아닌 응답(인증키 오류 안내 HTML 등)은 실패한다', async () => {
    const client = new FlowerAuctionClient(
      new ConfigService({ FLOWER_AUCTION_API_KEY: API_KEY }),
      async () => ({ ok: true, status: 200, text: async () => '<html>SERVICE KEY IS NOT REGISTERED</html>' }),
    );
    await expect(client.fetchDay('2026-10-26', 3)).rejects.toThrow('JSON이 아닙니다');
  });
});

describe('시세 묶음 계산', () => {
  const point = (d: string, g: string, avg: number, qty: number, min = avg, max = avg): MarketPricePoint => ({
    d,
    g,
    avg,
    min,
    max,
    qty,
    amt: avg * qty,
  });

  it('같은 날·같은 등급 줄은 물량 가중으로 하나로 합친다', () => {
    const rows = parseFlowerAuctionResponse(
      {
        items: [
          row({ avgAmt: 10000, totAmt: 100000, totQty: 10, minAmt: 8000, maxAmt: 12000 }),
          row({ avgAmt: 20000, totAmt: 600000, totQty: 30, minAmt: 15000, maxAmt: 25000 }),
          row({ goodName: '다른 품종' }),
        ],
      },
      '2026-10-26',
      3,
    );
    const series = groupRowsBySeries(rows);
    expect(series).toHaveLength(2);
    const main = series.find((s) => s.id === marketSeriesId(3, '호접란', '만천홍'))!;
    expect(main.points).toEqual([{ d: '2026-10-26', g: '특', avg: 17500, min: 8000, max: 25000, qty: 40, amt: 700000 }]);
  });

  it('다시 받은 날·등급은 새 값으로 바꾸고 보관 기한보다 오래된 날은 지운다', () => {
    const merged = mergeSeriesPoints(
      [point('2025-01-01', '특', 1, 1), point('2026-10-19', '특', 9000, 5)],
      [point('2026-10-19', '특', 9500, 6), point('2026-10-26', '특', 10000, 4)],
      '2025-09-22',
    );
    expect(merged.map((p) => [p.d, p.avg])).toEqual([
      ['2026-10-19', 9500],
      ['2026-10-26', 10000],
    ]);
  });

  it('최근 경매일·최근 4주를 물량 가중으로 내고 상품 1개 기준 매입가를 곱한다', () => {
    const points = [
      point('2026-09-14', '특', 99999, 100), // 4주 밖
      point('2026-10-19', '특', 10000, 10, 8000, 13000),
      point('2026-10-19', '상', 6000, 10, 5000, 7000),
      point('2026-10-26', '특', 12000, 30, 9000, 15000),
    ];
    const ref = { flowerGubn: 3 as const, pumName: '호접란', goodName: '만천홍', unitsPerItem: 2 };

    const all = summarizeMarketPoints(points, ref, '2026-10-27');
    expect(all.grades).toEqual(['상', '특']);
    expect(all.latest).toEqual({ saleDate: '2026-10-26', avg: 12000, min: 9000, max: 15000, qty: 30 });
    // (10000×10 + 6000×10 + 12000×30) / 50 = 10400
    expect(all.recent).toEqual({ from: '2026-10-19', to: '2026-10-26', auctionDays: 2, avg: 10400, min: 5000, max: 15000, qty: 50 });
    expect(all.unitCost).toEqual({ latest: 24000, recentAvg: 20800 });

    const special = summarizeMarketPoints(points, { ...ref, grade: '특' }, '2026-10-27');
    // (10000×10 + 12000×30) / 40 = 11500
    expect(special.recent?.avg).toBe(11500);
    expect(special.unitCost.recentAvg).toBe(23000);

    const none = summarizeMarketPoints(points, { ...ref, grade: '보' }, '2026-10-27');
    expect(none).toEqual(expect.objectContaining({ latest: null, recent: null, unitCost: { latest: null, recentAvg: null } }));
  });

  it('4주 동안 거래가 없으면 최근 시세는 비우고 마지막 경매일은 남긴다', () => {
    const summary = summarizeMarketPoints(
      [point('2026-08-03', '특', 10000, 1)],
      { flowerGubn: 3, pumName: '호접란', unitsPerItem: 1 },
      '2026-10-27',
    );
    expect(summary.recent).toBeNull();
    expect(summary.latest?.saleDate).toBe('2026-08-03');
  });
});

describe('상품 시세 연결 저장 형식', () => {
  const check = async (marketRef: unknown) =>
    validate(plainToInstance(UpdateProductDto, { marketRef }), { whitelist: true, forbidNonWhitelisted: true });

  it('부류·품목·상품 1개당 단위 수가 맞으면 받고, null은 연결 지우기로 받는다', async () => {
    expect(await check({ flowerGubn: 3, pumName: '호접란', goodName: '만천홍', grade: '특', unitsPerItem: 1 })).toEqual([]);
    expect(await check({ flowerGubn: 1, pumName: '장미', unitsPerItem: 0.5 })).toEqual([]);
    expect(await check(null)).toEqual([]);
  });

  it.each([
    ['모르는 부류', { flowerGubn: 9, pumName: '호접란', unitsPerItem: 1 }],
    ['품목 없음', { flowerGubn: 3, unitsPerItem: 1 }],
    ['앞뒤 공백', { flowerGubn: 3, pumName: ' 호접란', unitsPerItem: 1 }],
    ['줄바꿈', { flowerGubn: 3, pumName: '호접\n란', unitsPerItem: 1 }],
    ['단위 수 0', { flowerGubn: 3, pumName: '호접란', unitsPerItem: 0 }],
    ['단위 수 너무 큼', { flowerGubn: 3, pumName: '호접란', unitsPerItem: 101 }],
    ['모르는 칸', { flowerGubn: 3, pumName: '호접란', unitsPerItem: 1, price: 1 }],
  ])('%s → 거절한다', async (_label, marketRef) => {
    expect((await check(marketRef)).length).toBeGreaterThan(0);
  });
});

describe('경매 시세 수집·판매자 조회', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let memory: ReturnType<typeof createInMemoryFirestore>;
  let responses: Map<string, () => ReturnType<FlowerAuctionFetch>>;

  async function start(config: Record<string, string>) {
    const fetcher: FlowerAuctionFetch = async (url) => {
      const params = new URL(url).searchParams;
      const respond = responses.get(`${params.get('baseDate')}/${params.get('flowerGubn')}`);
      return respond ? respond() : ok({ response: { items: [] } });
    };
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: JWT_SECRET })],
      controllers: [MarketPricesController],
      providers: [
        MarketPricesService,
        FlowerAuctionClient,
        { provide: FLOWER_AUCTION_FETCH, useValue: fetcher },
        { provide: FirestoreService, useValue: memory.firestore },
        { provide: ConfigService, useValue: new ConfigService({ JWT_SECRET, ...config }) },
        JwtAuthGuard,
        RolesGuard,
        JwtStrategy,
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(sanitizedValidationPipeOptions()));
    jwt = app.get(JwtService);
    await app.init();
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout'] });
    responses = new Map();
    memory = createInMemoryFirestore({
      ...Object.fromEntries(
        Object.values(ACTORS).map((actor) => [`users/${actor.sub}`, { role: actor.role, storeId: actor.storeId }]),
      ),
      'stores/store-1': { ownerId: 'seller-1', name: '그린러브' },
      'stores/store-2': { ownerId: 'seller-2', name: '다른 가게' },
      'products/p-orchid': {
        storeId: 'store-1',
        name: '만천홍 호접란',
        marketRef: { flowerGubn: 3, pumName: '호접란', goodName: '만천홍', unitsPerItem: 1 },
      },
      'products/p-any-orchid': {
        storeId: 'store-1',
        name: '호접란 아무 품종',
        marketRef: { flowerGubn: 3, pumName: '호접란', grade: '특', unitsPerItem: 1 },
      },
      'products/p-unmapped': { storeId: 'store-1', name: '연결 안 한 상품' },
      'products/p-other': {
        storeId: 'store-2',
        name: '다른 가게 상품',
        marketRef: { flowerGubn: 3, pumName: '호접란', goodName: '만천홍', unitsPerItem: 1 },
      },
    });
  });

  afterEach(async () => {
    await app?.close();
    jest.useRealTimers();
  });

  function auth(test: request.Test, actor?: Actor) {
    if (!actor) return test;
    const { sub, role, storeId } = ACTORS[actor];
    return test.set('Authorization', `Bearer ${jwt.sign({ sub, role, storeId })}`);
  }
  const get = (path: string, actor?: Actor) => auth(request(app.getHttpServer()).get(path), actor);
  const service = () => app.get(MarketPricesService);

  it('인증키가 없으면 수집하지 않는다', async () => {
    await start({});
    await expect(service().ingest(NOW)).resolves.toEqual({ status: 'NOT_CONFIGURED' });
    await service().runScheduledIngest();
    expect([...memory.records.keys()].some((path) => path.startsWith('marketPriceSeries/'))).toBe(false);
  });

  it('최근 3일·4부류를 받아 시세 묶음과 이름 목록을 저장하고, 다시 받아도 같은 결과다', async () => {
    await start({ FLOWER_AUCTION_API_KEY: API_KEY });
    responses.set('2026-10-26/3', () =>
      ok({ response: { items: [row(), row({ lvNm: '상', avgAmt: 8000, totAmt: 80000 }), row({ goodName: '소형' })] } }),
    );
    responses.set('2026-10-26/1', () =>
      ok({ response: { items: [row({ flowerGubn: '1', pumName: '장미', goodName: '레드나오미', avgAmt: 5000, totAmt: 50000 })] } }),
    );

    const first = await service().ingest(NOW);
    expect(first).toEqual({ status: 'DONE', dates: ['2026-10-27', '2026-10-26', '2026-10-25'], rows: 4, series: 3, failures: [] });

    const seriesPath = `marketPriceSeries/${marketSeriesId(3, '호접란', '만천홍')}`;
    const saved = memory.read(seriesPath);
    expect(saved).toEqual(
      expect.objectContaining({
        flowerGubn: 3,
        pumName: '호접란',
        goodName: '만천홍',
        points: [
          { d: '2026-10-26', g: '상', avg: 8000, min: 8000, max: 15000, qty: 10, amt: 80000 },
          { d: '2026-10-26', g: '특', avg: 12000, min: 9000, max: 15000, qty: 10, amt: 120000 },
        ],
      }),
    );
    expect(memory.read('marketPriceCatalog/3')?.['items']).toEqual([{ pumName: '호접란', goodNames: ['만천홍', '소형'] }]);
    expect(memory.read('marketPriceCatalog/1')?.['items']).toEqual([{ pumName: '장미', goodNames: ['레드나오미'] }]);

    await service().ingest(NOW);
    expect(memory.read(seriesPath)?.['points']).toEqual(saved?.['points']);
  });

  it('일부 날·부류를 못 받아도 받은 만큼 저장하고, 그날 작업은 완료로 남기지 않는다', async () => {
    await start({ FLOWER_AUCTION_API_KEY: API_KEY });
    responses.set('2026-10-26/3', () => ok({ response: { items: [row()] } }));
    responses.set('2026-10-27/1', () => Promise.reject(new Error('timeout')));

    await service().runScheduledIngest();

    expect(memory.read(`marketPriceSeries/${marketSeriesId(3, '호접란', '만천홍')}`)).toBeDefined();
    const lease = memory.read(`${JOB_LEASE_COLLECTION}/${MARKET_PRICES_INGEST_JOB_NAME}`);
    expect(lease?.['lastCompletedSlot']).toBeUndefined();
    expect(lease?.['holderId']).toBeNull();
  });

  it('모두 받으면 그날 작업을 완료로 남겨 다시 돌지 않는다', async () => {
    await start({ FLOWER_AUCTION_API_KEY: API_KEY });
    await service().runScheduledIngest();
    expect(memory.read(`${JOB_LEASE_COLLECTION}/${MARKET_PRICES_INGEST_JOB_NAME}`)?.['lastCompletedSlot']).toBe('2026-10-27');
  });

  describe('판매자 조회', () => {
    beforeEach(async () => {
      await start({ FLOWER_AUCTION_API_KEY: API_KEY });
      responses.set('2026-10-26/3', () =>
        ok({
          response: {
            items: [
              row(),
              row({ lvNm: '상', avgAmt: 8000, totAmt: 80000 }),
              row({ goodName: '소형', avgAmt: 6000, totAmt: 60000 }),
            ],
          },
        }),
      );
      await service().ingest(NOW);
    });

    it('자기 가게 상품의 시세를 주고, 연결이 없거나 다른 가게 상품은 null이다', async () => {
      const res = await get('/stores/store-1/market-prices?productIds=p-orchid,p-any-orchid,p-unmapped,p-other,missing', 'seller').expect(200);
      const { summaries } = res.body;
      expect(summaries['p-orchid']).toEqual(
        expect.objectContaining({
          latest: { saleDate: '2026-10-26', avg: 10000, min: 8000, max: 15000, qty: 20 },
          unitCost: { latest: 10000, recentAvg: 10000 },
          grades: ['상', '특'],
        }),
      );
      // 품종을 안 정하면 품목의 모든 품종(만천홍·소형)에서 '특' 등급만 합친다: (120000+60000)/20
      expect(summaries['p-any-orchid'].latest).toEqual(expect.objectContaining({ avg: 9000, qty: 20 }));
      expect(summaries['p-unmapped']).toBeNull();
      expect(summaries['p-other']).toBeNull();
      expect(summaries['missing']).toBeNull();
    });

    it('이름 목록과 저장 전 미리 보기를 준다', async () => {
      const catalog = await get('/stores/store-1/market-prices/catalog?flowerGubn=3', 'seller').expect(200);
      expect(catalog.body).toEqual({
        flowerGubn: 3,
        items: [{ pumName: '호접란', goodNames: ['만천홍', '소형'] }],
        updatedAt: NOW.toISOString(),
      });
      const empty = await get('/stores/store-1/market-prices/catalog?flowerGubn=2', 'seller').expect(200);
      expect(empty.body).toEqual({ flowerGubn: 2, items: [], updatedAt: null });

      const lookup = await get(
        `/stores/store-1/market-prices/lookup?flowerGubn=3&pumName=${encodeURIComponent('호접란')}&goodName=${encodeURIComponent('만천홍')}&grade=${encodeURIComponent('특')}&unitsPerItem=1.5`,
        'seller',
      ).expect(200);
      expect(lookup.body.unitCost).toEqual({ latest: 18000, recentAvg: 18000 });
    });

    it('형식이 틀린 요청은 거절한다', async () => {
      await get('/stores/store-1/market-prices', 'seller').expect(400);
      await get('/stores/store-1/market-prices?productIds=a/b', 'seller').expect(400);
      await get('/stores/store-1/market-prices/catalog?flowerGubn=5', 'seller').expect(400);
      await get('/stores/store-1/market-prices/lookup?flowerGubn=3', 'seller').expect(400);
      await get(`/stores/store-1/market-prices/lookup?flowerGubn=3&pumName=a&unitsPerItem=0`, 'seller').expect(400);
    });

    it('다른 가게 판매자·소비자·비로그인은 보지 못하고, 관리자는 본다', async () => {
      await get('/stores/store-1/market-prices?productIds=p-orchid', 'otherSeller').expect(403);
      await get('/stores/store-1/market-prices/catalog?flowerGubn=3', 'otherSeller').expect(403);
      await get('/stores/store-1/market-prices?productIds=p-orchid', 'consumer').expect(403);
      await get('/stores/store-1/market-prices?productIds=p-orchid').expect(401);
      const res = await get('/stores/store-1/market-prices?productIds=p-orchid', 'admin').expect(200);
      expect(res.body.summaries['p-orchid']).not.toBeNull();
    });
  });
});
