'use client';

import { apiPathSegment, type OptionStock } from '@greenhub/shared';
import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import { readOptionStocks } from '@/app/settings/option-stocks/_lib';

/**
 * 상품 옵션 선택지에 연결할 매장 옵션 재고 목록(직접 출력한 화분 등).
 * enabled가 false면(옵션 시트 꺼짐) 부르지 않는다. 실패하면 빈 목록과 오류 문구를 돌려준다.
 */
export function useOptionStocks(storeId: string | undefined, token: string | undefined, enabled: boolean) {
  const [stocks, setStocks] = useState<OptionStock[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !storeId || !token) return;
    let cancelled = false;
    apiJson(`/stores/${apiPathSegment(storeId)}/option-stocks`, token)
      .then((body) => {
        if (cancelled) return;
        setStocks(readOptionStocks(body));
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError('옵션 재고를 불러오지 못했어요. 재고 연결은 저장된 값 그대로 둬요.');
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, storeId, token]);

  return { stocks, error };
}
