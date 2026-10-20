'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import {
  buildOrderSummaryPath,
  buildSellerOrdersScopeKey,
  parseArchivedGroupCounts,
} from './useOrders.recovery';

type ArchivedGroupCounts = { DONE: number; CANCELLED: number };

/**
 * 끝난 주문(완료·취소) 건수만 받는다. 홈은 건수만 필요하므로 끝난 주문 목록을 내려받지 않는다.
 * 받기 전이나 처음부터 실패하면 null(0건으로 속이지 않는다). 다시 받다 실패하면 이전 값을 유지한다.
 * 화면에 돌아오면(포커스·탭 복귀) 다시 받는다 — 주문 목록과 같은 시점이다.
 */
export function useOrderSummary(storeId: string | null): ArchivedGroupCounts | null {
  const { data: session } = useSession();
  const token = session?.user.accessToken ?? null;
  const scopeKey = buildSellerOrdersScopeKey(storeId, token, 'summary');
  const [result, setResult] = useState<{ scope: string; counts: ArchivedGroupCounts } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void tick;
    if (!storeId || !token) return;
    let active = true;
    apiJson(buildOrderSummaryPath(storeId), token)
      .then((payload) => {
        if (active) setResult({ scope: scopeKey, counts: parseArchivedGroupCounts(payload) });
      })
      .catch(() => {
        // 실패는 이전 값을 그대로 둔다(첫 실패면 null로 남아 화면이 '—'로 보인다).
      });
    return () => {
      active = false;
    };
  }, [storeId, token, scopeKey, tick]);

  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState !== 'hidden') setTick((t) => t + 1);
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, []);

  return result?.scope === scopeKey ? result.counts : null;
}
