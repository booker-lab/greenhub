'use client';

import type { SalesMode } from '@greenhub/shared';
import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import {
  resolveStoreSalesModeState,
  type StoreSalesModeResult,
  type StoreSalesModeState,
  toMenuSalesMode,
} from './useStoreSalesMode.state';

/**
 * 가게 판매 방식과 조회 상태. 조회 실패를 실제 예전 방식(legacy)과 구분해야 하는 화면이 쓴다.
 * 메뉴·입력 숨김에는 실패를 'legacy'로 돌려주는 useStoreSalesMode를 쓴다.
 */
export function useStoreSalesModeState(
  storeId: string | null | undefined,
  token: string | null | undefined,
): StoreSalesModeState {
  const [result, setResult] = useState<StoreSalesModeResult | null>(null);

  useEffect(() => {
    if (!storeId || !token) return;
    let cancelled = false;
    apiJson<{ salesMode?: SalesMode }>(`/stores/${storeId}/public-profile`, token)
      .then((profile) => {
        if (!cancelled)
          setResult({ storeId, status: 'ready', salesMode: profile.salesMode ?? 'legacy' });
      })
      .catch(() => {
        if (!cancelled) setResult({ storeId, status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, token]);

  // 다른 가게의 이전 결과는 쓰지 않는다.
  return resolveStoreSalesModeState(result, storeId);
}

/**
 * 가게 판매 방식. 회차 판매(round_direct) 가게에 예전 방식(legacy) 메뉴·입력을 숨길 때 쓴다.
 * 조회 중이면 undefined(숨긴 상태로 시작해 깜빡임이 없다), 조회에 실패하면 접근을 막지 않도록 'legacy'.
 */
export function useStoreSalesMode(
  storeId: string | null | undefined,
  token: string | null | undefined,
): SalesMode | undefined {
  return toMenuSalesMode(useStoreSalesModeState(storeId, token));
}
