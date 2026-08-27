'use client';

import type { Order } from '@greenhub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-base-url';

const API = getApiBaseUrl();
const TERMINAL_STATUSES = new Set(['CANCELLED', 'DELIVERED', 'REVIEWED']);
// NOTE: Firebase SDK의 onSnapshot은 PWA Service Worker와 충돌하여 동작 불가.
// Firestore REST API 대신 Railway API 폴링 방식으로 대체. 설계 결정: docs/CRITICAL_LOGIC.md [2026-03-27] 참조

interface UseOrderStatusResult {
  order: Order | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<Order | null | undefined>;
}

export function useOrderStatus(orderId: string | null, accessToken?: string): UseOrderStatusResult {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchOrderRef = useRef<(() => Promise<Order | null | undefined>) | null>(null);
  const refetch = useCallback(() => fetchOrderRef.current?.() ?? Promise.resolve(undefined), []);

  useEffect(() => {
    // accessToken이 undefined면 세션 아직 로딩 중 — 대기
    if (!orderId) {
      setLoading(false);
      setOrder(null);
      return;
    }
    if (accessToken === undefined) return;

    let cancelled = false;
    let requestSequence = 0;
    let activeController: AbortController | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function fetchOrder(): Promise<Order | null | undefined> {
      const sequence = ++requestSequence;
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

        const res = await fetch(`${API}/orders/${orderId}`, {
          headers,
          signal: controller.signal,
        });
        if (cancelled || sequence !== requestSequence) return undefined;

        if (res.status === 404) {
          setOrder(null);
          setLoading(false);
          setError(null);
          return null;
        }
        if (!res.ok) throw new Error('주문 정보를 불러올 수 없습니다.');

        const data = await res.json();
        if (cancelled || sequence !== requestSequence) return undefined;
        const latestOrder = data as Order;
        setOrder(latestOrder);
        setLoading(false);
        setError(null);
        // 종료 상태 도달 시 폴링 중단
        if (TERMINAL_STATUSES.has(latestOrder.status) && interval) clearInterval(interval);
        return latestOrder;
      } catch (e: unknown) {
        if (
          cancelled ||
          sequence !== requestSequence ||
          (e instanceof DOMException && e.name === 'AbortError')
        ) {
          return undefined;
        }
        setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
        setLoading(false);
        return undefined;
      }
    }

    fetchOrderRef.current = fetchOrder;
    interval = setInterval(() => void fetchOrder(), 3000);
    void fetchOrder();
    return () => {
      cancelled = true;
      requestSequence += 1;
      activeController?.abort();
      if (fetchOrderRef.current === fetchOrder) fetchOrderRef.current = null;
      if (interval) clearInterval(interval);
    };
  }, [orderId, accessToken]);

  return { order, loading, error, refetch };
}
