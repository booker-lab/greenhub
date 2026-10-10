'use client';

import type { Order } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { ApiError, apiJson } from '@/lib/api';
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
 * @deprecated POST phone-search 경로가 없는 이전 API 배포용 GET(?phone=) 경로.
 * API와 판매자 앱이 따로 배포되는 동안만 쓰며, 두 앱이 모두 배포된 뒤 제거한다.
 */
export function buildLegacyOrderPhoneSearchPath(storeId: string, digits: string): string {
  return `${buildSellerOrdersPath(storeId)}?phone=${encodeURIComponent(digits)}`;
}

/**
 * POST 본문으로 검색하고, API가 아직 그 경로를 모르는 이전 배포(404)일 때만
 * deprecated GET으로 한 번 대체한다. 다른 오류는 그대로 던진다.
 */
export async function requestOrderPhoneSearch<T>(
  storeId: string,
  digits: string,
  request: (path: string, init?: RequestInit) => Promise<T>,
): Promise<T> {
  const { path, init } = buildOrderPhoneSearchRequest(storeId, digits);
  try {
    return await request(path, init);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return request(buildLegacyOrderPhoneSearchPath(storeId, digits));
    }
    throw error;
  }
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
