import type { MarketPriceSummary } from '@greenhub/shared';
import { describe, expect, it } from 'vitest';
import {
  checkRoundPrice,
  defaultMarketRefForm,
  estimatePurchase,
  marketLookupQuery,
  marketRefBody,
  marketRefFormFromProduct,
  marketSummaryLines,
  roundPriceCheckText,
} from './market-price';

function summary(overrides: Partial<MarketPriceSummary> = {}): MarketPriceSummary {
  return {
    ref: { flowerGubn: 3, pumName: '호접란', goodName: '만천홍', unitsPerItem: 1 },
    latest: { saleDate: '2026-10-26', avg: 12000, min: 9000, max: 15000, qty: 30 },
    recent: { from: '2026-10-05', to: '2026-10-26', auctionDays: 4, avg: 11000, min: 8000, max: 15000, qty: 120 },
    unitCost: { latest: 12000, recentAvg: 11000 },
    grades: ['상', '특'],
    ...overrides,
  };
}

describe('경매 시세 연결 칸', () => {
  it('부류를 고르지 않으면 연결 지우기(null)로 보낸다', () => {
    expect(marketRefBody(defaultMarketRefForm())).toEqual({ ok: true, body: null });
    expect(marketLookupQuery(defaultMarketRefForm())).toBeNull();
  });

  it('이름 앞뒤 공백을 지우고 빈 품종·등급은 빼서 보낸다', () => {
    const form = { flowerGubn: '1' as const, pumName: ' 장미 ', goodName: ' ', grade: '', unitsPerItem: '0.5' };
    expect(marketRefBody(form)).toEqual({
      ok: true,
      body: { flowerGubn: 1, pumName: '장미', unitsPerItem: 0.5 },
    });
    expect(marketLookupQuery(form)).toBe('flowerGubn=1&pumName=%EC%9E%A5%EB%AF%B8&unitsPerItem=0.5');
  });

  it.each([
    ['품목 없음', { pumName: '' }, '품목 이름'],
    ['단위 수 0', { unitsPerItem: '0' }, '단위 수'],
    ['단위 수 소수 셋째 자리', { unitsPerItem: '1.234' }, '단위 수'],
    ['단위 수 너무 큼', { unitsPerItem: '101' }, '단위 수'],
  ])('%s → 저장 전에 막는다', (_label, patch, message) => {
    const result = marketRefBody({ ...defaultMarketRefForm(), flowerGubn: '3', pumName: '호접란', ...patch });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain(message);
  });

  it('저장된 연결을 칸으로 되돌리고, 모양이 틀리면 빈 칸이다', () => {
    expect(
      marketRefFormFromProduct({ flowerGubn: 3, pumName: '호접란', goodName: '만천홍', grade: '특', unitsPerItem: 2 }),
    ).toEqual({ flowerGubn: '3', pumName: '호접란', goodName: '만천홍', grade: '특', unitsPerItem: '2' });
    expect(marketRefFormFromProduct(null)).toEqual(defaultMarketRefForm());
    expect(marketRefFormFromProduct({ flowerGubn: 7, pumName: 'x' })).toEqual(defaultMarketRefForm());
  });
});

describe('회차 가격과 예상 매입가', () => {
  it('최근 4주 평균 매입가를 먼저 쓰고, 낮으면 경고한다', () => {
    const below = checkRoundPrice(10000, summary());
    expect(below).toEqual({ kind: 'below', cost: 11000, diff: -1000 });
    expect(roundPriceCheckText(below)).toBe('예상 매입가 11,000원보다 1,000원 낮아요. 경매가가 그대로면 팔수록 손해예요.');

    const margin = checkRoundPrice(22000, summary());
    expect(margin).toEqual({ kind: 'margin', cost: 11000, diff: 11000, rate: 50 });
    expect(roundPriceCheckText(margin)).toBe('예상 매입가 11,000원 · 차액 11,000원 (50%)');
  });

  it('4주 시세가 없으면 마지막 경매일 값을 쓰고, 둘 다 없거나 가격이 없으면 비교하지 않는다', () => {
    expect(checkRoundPrice(20000, summary({ recent: null, unitCost: { latest: 12000, recentAvg: null } }))).toEqual(
      expect.objectContaining({ cost: 12000 }),
    );
    expect(checkRoundPrice(20000, summary({ recent: null, latest: null, unitCost: { latest: null, recentAvg: null } }))).toEqual({ kind: 'none' });
    expect(checkRoundPrice(null, summary())).toEqual({ kind: 'none' });
    expect(checkRoundPrice(20000, null)).toEqual({ kind: 'none' });
  });

  it('시세 요약 줄은 경매 단위(분화 1분·절화 1속)와 상품 1개 기준을 함께 쓴다', () => {
    expect(marketSummaryLines(summary())).toEqual([
      '최근 4주 평균 11,000원/분 (경매 4일, 8,000원~15,000원)',
      '마지막 경매 10/26 평균 12,000원/분',
      '상품 1개 예상 매입가 11,000원',
    ]);
    const roses = summary({
      ref: { flowerGubn: 1, pumName: '장미', unitsPerItem: 2 },
      recent: null,
      unitCost: { latest: 24000, recentAvg: null },
    });
    expect(marketSummaryLines(roses)).toEqual([
      '마지막 경매 10/26 평균 12,000원/속',
      '상품 1개 예상 매입가 24,000원 (2속 기준)',
    ]);
    expect(marketSummaryLines(summary({ recent: null, latest: null, unitCost: { latest: null, recentAvg: null } }))).toEqual([
      '아직 이 조건으로 수집된 경매 시세가 없어요.',
    ]);
  });
});

describe('구매 목록 예상 매입액', () => {
  it('시세를 아는 상품만 더하고 모르는 상품 수를 따로 센다', () => {
    const result = estimatePurchase(
      [
        { productId: 'p-orchid', quantity: 3 },
        { productId: 'p-unmapped', quantity: 2 },
        { productId: 'p-none-ordered', quantity: 0 },
      ],
      { 'p-orchid': summary(), 'p-unmapped': null },
    );
    expect(result.total).toBe(33000);
    expect(result.unknownCount).toBe(1);
    expect(result.lines[0]).toEqual({ productId: 'p-orchid', quantity: 3, unitCost: 11000, cost: 33000 });
  });
});
