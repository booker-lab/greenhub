'use client';

import type { Order } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import { buildSellerOrdersPath } from './useOrders.recovery';

const DEBOUNCE_MS = 300;

/**
 * 전화 검색 요청 — 전화번호가 URL·접속 로그에 남지 않도록 POST 본문으로 보낸다.
 * 경로에는 매장 id만 들어간다.
 */
export function buildOrderPhoneSearchRequest(
  storeId: string,
  digits: string,
): { path: string; init: RequestInit } {
  return {
    path: `${buildSellerOrdersPath(storeId)}/phone-search`,
    init: { method: 'POST', body: JSON.stringify({ phone: digits }) },
  };
}

/**
 * 전화 검색을 POST 본문으로만 보낸다. 오류는 그대로 던진다.
 * 이전에는 404면 전화번호를 쿼리 문자열에 붙인 GET으로 한 번 대체했는데, POST 경로가 운영 API에
 * 배포된 뒤(2026-11-28 운영 Release `prod-20261128-72fac307`에서 API·판매자 앱 모두 POST 사용 확인)에는
 * 매장 없음 같은 다른 404에서 전화번호를 URL·접속 기록에 남기기만 해서 지웠다.
 */
export async function requestOrderPhoneSearch<T>(
  storeId: string,
  digits: string,
  request: (path: string, init?: RequestInit) => Promise<T>,
): Promise<T> {
  const { path, init } = buildOrderPhoneSearchRequest(storeId, digits);
  return request(path, init);
}

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
      requestOrderPhoneSearch(storeId, digits, (path, init) => apiJson<Order[]>(path, token, init))
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
