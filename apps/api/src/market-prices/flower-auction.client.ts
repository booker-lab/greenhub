import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FLOWER_MARKET_GUBN_LABELS, type FlowerMarketGubn, MARKET_NAME_MAX_LENGTH } from '@greenhub/shared';
import { ISO_DATE_PATTERN, type MarketAuctionRow } from './market-price.fields';

/**
 * aT 화훼유통정보시스템 경락가격 OpenAPI(kind=f001) 클라이언트.
 *
 * 요청 변수 serviceKey·baseDate·flowerGubn·dataType은 aT 공개 안내(flower.at.or.kr/api/apiOpenInfo.do)에서
 * 확인했다. 응답 항목 이름(RESPONSE_FIELDS)과 요청 주소는 실제 응답으로 아직 확인하지 못했으므로,
 * 모양이 다르면 저장하지 않고 실패한다(빈 시세나 0원을 저장하지 않는다). 주소는 FLOWER_AUCTION_API_URL로 바꿀 수 있다.
 */
export const FLOWER_AUCTION_DEFAULT_URL = 'https://flower.at.or.kr/api/returnData.api';
export const FLOWER_AUCTION_REQUEST_TIMEOUT_MS = 15_000;
/** 한 번에 받는 줄 수. 이만큼 꽉 차서 오면 잘렸을 수 있으므로 실패로 본다. */
export const FLOWER_AUCTION_PAGE_SIZE = 1000;

export const RESPONSE_FIELDS = {
  saleDate: 'saleDate',
  pumName: 'pumName',
  goodName: 'goodName',
  grade: 'lvNm',
  max: 'maxAmt',
  min: 'minAmt',
  avg: 'avgAmt',
  amt: 'totAmt',
  qty: 'totQty',
} as const;

export class FlowerAuctionResponseError extends Error {}

export type FlowerAuctionFetch = (url: string, init: { signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export const FLOWER_AUCTION_FETCH = Symbol('FLOWER_AUCTION_FETCH');

/** "1,234"·" 1234 " 같은 숫자 문자열도 받는다. 숫자가 아니면 null. */
function toAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

function toName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 0 && text.length <= MARKET_NAME_MAX_LENGTH ? text : null;
}

function toSaleDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (ISO_DATE_PATTERN.test(text)) return text;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return null;
}

/** 응답에서 줄 목록을 찾는다. 알려진 자리에 없으면 null. */
function findItems(body: unknown): unknown[] | null {
  const root = body as Record<string, any> | null;
  const candidates = [root?.['response']?.['items'], root?.['response']?.['body']?.['items'], root?.['items']];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (Array.isArray(candidate?.['item'])) return candidate['item'];
  }
  return null;
}

function resultCode(body: unknown): string | null {
  const response = (body as Record<string, any> | null)?.['response'];
  const code = response?.['resultCd'] ?? response?.['resultCode'] ?? response?.['header']?.['resultCode'];
  return code === undefined || code === null ? null : String(code);
}

/**
 * 응답 본문을 정규화한다. 줄 목록을 못 찾거나, 줄이 있는데 하나도 읽지 못하면 실패한다.
 * 물량·평균가가 0인 줄(거래 없음)만 건너뛴다.
 */
export function parseFlowerAuctionResponse(
  body: unknown,
  baseDate: string,
  flowerGubn: FlowerMarketGubn,
): MarketAuctionRow[] {
  const code = resultCode(body);
  if (code !== null && !['0', '00', '000', 'INFO-000'].includes(code)) {
    throw new FlowerAuctionResponseError(`응답 결과 코드가 정상이 아닙니다: ${code}`);
  }
  const items = findItems(body);
  if (!items) {
    const keys = Object.keys((body as object | null) ?? {}).slice(0, 10).join(',');
    throw new FlowerAuctionResponseError(`응답에서 경매 결과 목록을 찾지 못했습니다(최상위 항목: ${keys}).`);
  }
  if (items.length >= FLOWER_AUCTION_PAGE_SIZE) {
    throw new FlowerAuctionResponseError(`한 번에 ${items.length}줄이 와서 잘렸을 수 있습니다.`);
  }

  const rows: MarketAuctionRow[] = [];
  let unreadable = 0;
  for (const item of items) {
    const raw = item as Record<string, unknown>;
    const saleDate = raw[RESPONSE_FIELDS.saleDate] === undefined ? baseDate : toSaleDate(raw[RESPONSE_FIELDS.saleDate]);
    const pumName = toName(raw[RESPONSE_FIELDS.pumName]);
    const goodName = toName(raw[RESPONSE_FIELDS.goodName]);
    const grade = toName(raw[RESPONSE_FIELDS.grade]) ?? '-';
    const avg = toAmount(raw[RESPONSE_FIELDS.avg]);
    const min = toAmount(raw[RESPONSE_FIELDS.min]);
    const max = toAmount(raw[RESPONSE_FIELDS.max]);
    const qty = toAmount(raw[RESPONSE_FIELDS.qty]);
    const amt = toAmount(raw[RESPONSE_FIELDS.amt]);
    if (!saleDate || !pumName || !goodName || avg === null || min === null || max === null || qty === null) {
      unreadable += 1;
      continue;
    }
    // 다른 날 결과가 섞여 오면 응답을 믿을 수 없다.
    if (saleDate !== baseDate) {
      throw new FlowerAuctionResponseError(`요청한 날(${baseDate})과 다른 경매일(${saleDate})이 왔습니다.`);
    }
    if (qty <= 0 || avg <= 0) continue;
    rows.push({
      saleDate,
      flowerGubn,
      pumName,
      goodName,
      grade,
      avg,
      min: Math.min(min, avg),
      max: Math.max(max, avg),
      qty,
      amt: amt !== null && amt > 0 ? amt : avg * qty,
    });
  }
  if (items.length > 0 && rows.length === 0 && unreadable > 0) {
    throw new FlowerAuctionResponseError(
      `${FLOWER_MARKET_GUBN_LABELS[flowerGubn]} ${items.length}줄을 하나도 읽지 못했습니다. 응답 항목 이름을 확인하세요.`,
    );
  }
  return rows;
}

@Injectable()
export class FlowerAuctionClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    @Inject(ConfigService) config: ConfigService,
    @Inject(FLOWER_AUCTION_FETCH) private readonly fetcher: FlowerAuctionFetch,
  ) {
    this.apiKey = (config.get<string>('FLOWER_AUCTION_API_KEY') ?? '').trim();
    this.baseUrl = (config.get<string>('FLOWER_AUCTION_API_URL') ?? '').trim() || FLOWER_AUCTION_DEFAULT_URL;
  }

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  /** 하루·부류 하나의 경매 결과. 오류 메시지에 인증키가 들어가지 않게 주소를 남기지 않는다. */
  async fetchDay(baseDate: string, flowerGubn: FlowerMarketGubn): Promise<MarketAuctionRow[]> {
    const url = new URL(this.baseUrl);
    url.search = new URLSearchParams({
      kind: 'f001',
      serviceKey: this.apiKey,
      baseDate,
      flowerGubn: String(flowerGubn),
      dataType: 'json',
      currentPage: '1',
      countPerPage: String(FLOWER_AUCTION_PAGE_SIZE),
    }).toString();

    const response = await this.fetcher(url.toString(), {
      signal: AbortSignal.timeout(FLOWER_AUCTION_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new FlowerAuctionResponseError(`경락가격 응답 status=${response.status}`);
    }
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new FlowerAuctionResponseError('경락가격 응답이 JSON이 아닙니다(인증키·요청 주소를 확인하세요).');
    }
    return parseFlowerAuctionResponse(body, baseDate, flowerGubn);
  }
}
