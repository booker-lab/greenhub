'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import { useTokenRef } from '@/lib/use-token-ref';
import {
  type PayoutAccountStatus,
  type PayoutAccountStatusResult,
  readPayoutAccountRegistration,
  resolvePayoutAccountStatus,
} from './usePayoutAccountStatus.state';

/**
 * 정산 계좌 등록 여부. 정산 계좌 화면(settings/payout-account)과 같은 엔드포인트를 읽는다.
 * 조회 실패는 미등록과 구분해 'error'로 돌려준다.
 */
export function usePayoutAccountStatus(
  storeId: string | null | undefined,
  token: string | null | undefined,
): PayoutAccountStatus {
  const [result, setResult] = useState<PayoutAccountStatusResult | null>(null);
  // 토큰 갱신만으로 다시 조회하지 않는다.
  const { tokenRef, hasToken } = useTokenRef(token);

  useEffect(() => {
    if (!storeId || !hasToken) return;
    let cancelled = false;
    apiJson(`/stores/${encodeURIComponent(storeId)}/payout-account`, tokenRef.current)
      .then((body) => {
        if (!cancelled) setResult({ storeId, status: readPayoutAccountRegistration(body) });
      })
      .catch(() => {
        if (!cancelled) setResult({ storeId, status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, hasToken, tokenRef]);

  return resolvePayoutAccountStatus(result, storeId);
}
