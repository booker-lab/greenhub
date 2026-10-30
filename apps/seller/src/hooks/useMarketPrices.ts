'use client';

import { apiPathSegment, type MarketCatalog, type MarketPriceSummary } from '@greenhub/shared';
import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';

// 경매 시세 조회. 시세는 참고값이라 실패해도 화면의 다른 동작을 막지 않고 오류 문구만 돌려준다.

const LOAD_ERROR = '경매 시세를 불러오지 못했어요.';

/** 상품별 시세(회차 가격·구매 목록). 연결이 없는 상품은 null이다. */
export function useMarketSummaries(storeId: string | undefined, token: string | undefined, productIds: readonly string[]) {
  const [summaries, setSummaries] = useState<Record<string, MarketPriceSummary | null>>({});
  const [error, setError] = useState<string | null>(null);
  const key = [...new Set(productIds)].sort().join(',');

  useEffect(() => {
    if (!storeId || !token || !key) return;
    let cancelled = false;
    apiJson<{ summaries?: Record<string, MarketPriceSummary | null> }>(
      `/stores/${apiPathSegment(storeId)}/market-prices?productIds=${encodeURIComponent(key)}`,
      token,
    )
      .then((body) => {
        if (cancelled) return;
        setSummaries(body.summaries ?? {});
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError(LOAD_ERROR);
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, token, key]);

  return { summaries, error };
}

/** 부류별 품목·품종 이름(상품 편집의 시세 연결 칸). */
export function useMarketCatalog(storeId: string | undefined, token: string | undefined, flowerGubn: string) {
  const [catalog, setCatalog] = useState<MarketCatalog | null>(null);

  useEffect(() => {
    setCatalog(null);
    if (!storeId || !token || !flowerGubn) return;
    let cancelled = false;
    apiJson<MarketCatalog>(
      `/stores/${apiPathSegment(storeId)}/market-prices/catalog?flowerGubn=${encodeURIComponent(flowerGubn)}`,
      token,
    )
      .then((body) => {
        if (!cancelled) setCatalog(body);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [storeId, token, flowerGubn]);

  return catalog;
}

/** 저장 전 연결 조건 미리 보기. 입력이 멈추고 잠시 뒤에 부른다. */
export function useMarketLookup(storeId: string | undefined, token: string | undefined, query: string | null) {
  const [summary, setSummary] = useState<MarketPriceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSummary(null);
    setError(null);
    if (!storeId || !token || !query) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      apiJson<MarketPriceSummary>(`/stores/${apiPathSegment(storeId)}/market-prices/lookup?${query}`, token)
        .then((body) => {
          if (!cancelled) setSummary(body);
        })
        .catch(() => {
          if (!cancelled) setError(LOAD_ERROR);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [storeId, token, query]);

  return { summary, error };
}
