'use client';

import type { Order } from '@greenhub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-base-url';

const TERMINAL_STATUSES = new Set(['CANCELLED', 'DELIVERED', 'REVIEWED']);
// NOTE: Firebase SDK의 onSnapshot은 PWA Service Worker와 충돌하여 동작 불가.
// Firestore REST API 대신 Railway API 폴링 방식으로 대체. 설계 결정: docs/CRITICAL_LOGIC.md [2026-03-27] 참조

/** 탭이 숨겨져 있으면 주문 상태 폴링을 쉰다(다시 보이면 바로 조회하고 이어 간다). */
export function isDocumentHidden(
  doc: { visibilityState?: string } | undefined = globalThis.document,
): boolean {
  return doc?.visibilityState === 'hidden';
}

export type OrderDetailReadStatus = 'loading' | 'found' | 'not-found' | 'auth' | 'network' | 'server';

export function classifyOrderDetailFetchFailure(input: {
  httpStatus?: number | null;
  hasResponse: boolean;
}): Exclude<OrderDetailReadStatus, 'loading' | 'found' | 'not-found'> {
  if (input.httpStatus === 401 || input.httpStatus === 403) return 'auth';
  if (!input.hasResponse) return 'network';
  return 'server';
}

export function getOrderDetailReadErrorMessage(
  status: Exclude<OrderDetailReadStatus, 'loading' | 'found' | 'not-found'>,
): string {
  if (status === 'auth') return '로그인이 필요하거나 이 주문을 볼 권한이 없습니다.';
  if (status === 'network') return '네트워크 연결을 확인하고 다시 시도해 주세요.';
  return '주문 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

interface UseOrderStatusResult {
  order: Order | null;
  loading: boolean;
  error: string | null;
  status: OrderDetailReadStatus;
  refetch: () => Promise<Order | null | undefined>;
}

export function useOrderStatus(
  orderId: string | null,
  accessToken?: string | null,
): UseOrderStatusResult {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<OrderDetailReadStatus>('loading');
  const fetchOrderRef = useRef<(() => Promise<Order | null | undefined>) | null>(null);
  const refetch = useCallback(() => fetchOrderRef.current?.() ?? Promise.resolve(undefined), []);

  useEffect(() => {
    // accessToken이 undefined면 세션 아직 로딩 중 — 대기
    if (!orderId) {
      setLoading(false);
      setOrder(null);
      setError(null);
      setStatus('not-found');
      return;
    }
    if (accessToken === undefined) return;
    if (!accessToken) {
      setOrder(null);
      setLoading(false);
      setStatus('auth');
      setError(getOrderDetailReadErrorMessage('auth'));
      return;
    }

    let cancelled = false;
    let requestSequence = 0;
    let activeController: AbortController | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    // 404·auth·종료 상태로 폴링을 끝냈으면 탭이 다시 보여도 재개하지 않는다.
    let pollingFinished = false;

    function stopPolling() {
      if (interval) clearInterval(interval);
      interval = null;
    }

    function finishPolling() {
      pollingFinished = true;
      stopPolling();
    }

    async function fetchOrder(): Promise<Order | null | undefined> {
      const sequence = ++requestSequence;
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

        const res = await fetch(`${getApiBaseUrl()}/orders/${orderId}`, {
          headers,
          signal: controller.signal,
        });
        if (cancelled || sequence !== requestSequence) return undefined;

        if (res.status === 404) {
          setOrder(null);
          setLoading(false);
          setError(null);
          setStatus('not-found');
          finishPolling();
          return null;
        }
        if (!res.ok) {
          const failure = classifyOrderDetailFetchFailure({
            httpStatus: res.status,
            hasResponse: true,
          });
          const message = getOrderDetailReadErrorMessage(failure);
          if (failure === 'auth') {
            setOrder(null);
            finishPolling();
          }
          setError(message);
          setLoading(false);
          setStatus(failure);
          return undefined;
        }

        const data = await res.json();
        if (cancelled || sequence !== requestSequence) return undefined;
        const latestOrder = data as Order;
        setOrder(latestOrder);
        setLoading(false);
        setError(null);
        setStatus('found');
        // 종료 상태 도달 시 폴링 중단
        if (TERMINAL_STATUSES.has(latestOrder.status)) finishPolling();
        return latestOrder;
      } catch (e: unknown) {
        if (
          cancelled ||
          sequence !== requestSequence ||
          (e instanceof DOMException && e.name === 'AbortError')
        ) {
          return undefined;
        }
        const failure = classifyOrderDetailFetchFailure({
          httpStatus: null,
          hasResponse: !(e instanceof TypeError),
        });
        setError(getOrderDetailReadErrorMessage(failure));
        setLoading(false);
        setStatus(failure);
        return undefined;
      }
    }

    function startPolling() {
      if (interval || pollingFinished || isDocumentHidden()) return;
      interval = setInterval(() => void fetchOrder(), 3000);
    }

    // 숨김 탭에서는 폴링을 멈춘다. 다시 보이면 최신 상태를 바로 조회하고 폴링을 이어 간다.
    function handleVisibilityChange() {
      if (isDocumentHidden()) {
        stopPolling();
        return;
      }
      if (pollingFinished || interval) return;
      void fetchOrder();
      startPolling();
    }

    fetchOrderRef.current = fetchOrder;
    globalThis.document?.addEventListener('visibilitychange', handleVisibilityChange);
    startPolling();
    void fetchOrder();
    return () => {
      cancelled = true;
      requestSequence += 1;
      activeController?.abort();
      if (fetchOrderRef.current === fetchOrder) fetchOrderRef.current = null;
      globalThis.document?.removeEventListener('visibilitychange', handleVisibilityChange);
      stopPolling();
    };
  }, [orderId, accessToken]);

  return { order, loading, error, status, refetch };
}
