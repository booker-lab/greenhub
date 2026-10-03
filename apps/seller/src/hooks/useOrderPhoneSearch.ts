'use client';

import type { Order } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import { buildSellerOrdersPath } from './useOrders.recovery';

const DEBOUNCE_MS = 300;

interface PhoneSearchState {
  key: string | null;
  matchIds: ReadonlySet<string> | null;
  error: boolean;
}

/**
 * 판매자 주문 목록 전화 검색 — 목록 응답에는 전화가 없으므로 서버에 숫자만 보내
 * 연락처가 맞는 자기 매장 주문 id만 받는다. digits가 null이면 호출하지 않는다.
 */
export function useOrderPhoneSearch(storeId: string | null, digits: string | null) {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const key = storeId && token && digits ? `${storeId}:${digits}` : null;
  const [state, setState] = useState<PhoneSearchState>({ key: null, matchIds: null, error: false });

  useEffect(() => {
    if (!key || !storeId || !token || !digits) return;
    let active = true;
    const timer = setTimeout(() => {
      const path = `${buildSellerOrdersPath(storeId)}?phone=${encodeURIComponent(digits)}`;
      apiJson<Order[]>(path, token)
        .then((payload) => {
          if (!active) return;
          if (!Array.isArray(payload)) throw new Error('전화 검색 응답 형식이 올바르지 않습니다.');
          setState({ key, matchIds: new Set(payload.map((order) => order.id)), error: false });
        })
        .catch(() => {
          if (active) setState({ key, matchIds: null, error: true });
        });
    }, DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, storeId, token, digits]);

  // 이전 검색어의 결과는 현재 검색어에 쓰지 않는다.
  const current = key !== null && state.key === key;
  return {
    phoneMatchIds: current ? state.matchIds : null,
    searching: key !== null && !current,
    error: current && state.error,
  };
}
