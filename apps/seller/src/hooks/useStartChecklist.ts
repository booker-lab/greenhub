'use client';

import { useMemo } from 'react';
import {
  buildStartChecklist,
  readPayoutAccountForChecklist,
  readSaleRoundsForChecklist,
  readStoreProductsForChecklist,
  type StartChecklist,
} from '@/app/_components/start-checklist';
import { usePayoutAccountStatus } from './usePayoutAccountStatus';
import { useStoreProducts } from './useStoreProducts';

const HIDDEN: StartChecklist = { visible: false, allDone: false, items: [] };

/**
 * 새 가게 시작 체크리스트 상태. 회차 목록은 화면이 이미 부르는 useSaleRounds 결과를 받아
 * 같은 목록을 두 번 조회하지 않는다. 가게가 없으면(세션 확인 전 등) 보이지 않는다.
 */
export function useStartChecklist(
  storeId: string | null | undefined,
  token: string | null | undefined,
  saleRounds: { rounds: ReadonlyArray<unknown>; loading: boolean; error: string | null },
): StartChecklist {
  const products = useStoreProducts(storeId ?? null);
  const payout = usePayoutAccountStatus(storeId, token);
  const roundCount = saleRounds.rounds.length;

  return useMemo(() => {
    if (!storeId) return HIDDEN;
    return buildStartChecklist({
      products: readStoreProductsForChecklist({
        hasLoaded: products.hasLoaded,
        loading: products.loading,
        error: products.error,
        productCount: products.products.length,
      }),
      rounds: readSaleRoundsForChecklist({
        loading: saleRounds.loading,
        error: saleRounds.error,
        roundCount,
      }),
      payout: readPayoutAccountForChecklist(payout),
    });
  }, [
    storeId,
    payout,
    products.hasLoaded,
    products.loading,
    products.error,
    products.products.length,
    saleRounds.loading,
    saleRounds.error,
    roundCount,
  ]);
}
