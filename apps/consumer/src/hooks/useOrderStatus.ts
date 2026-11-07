'use client';

import type { Order, OrderStatus } from '@greenhub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-base-url';

// NOTE: Firebase SDK의 onSnapshot은 PWA Service Worker와 충돌하여 동작 불가.
// Firestore REST API 대신 Railway API 폴링 방식으로 대체. 설계 결정: docs/CRITICAL_LOGIC.md [2026-03-27] 참조
// 폴링은 결제 확인을 기다리는 PENDING 주문만 3초 간격으로 하고 2분이 지나면 멈춘다(IP당 API 요청 한도 보호).
// 그 밖의 상태는 한 번 읽고 멈추며, 화면의 다시 확인(refetch)이 새로 읽고 2분 창을 다시 연다.
// 탭이 숨겨져 있으면 다음 확인을 미루고, 다시 보이면 바로 확인한 뒤 같은 2분 창 안에서 이어 간다.
export const ORDER_STATUS_POLL_INTERVAL_MS = 3000;
export const ORDER_STATUS_POLL_MAX_MS = 2 * 60 * 1000;

// 결제 확인(checkPendingPayment)을 켠 화면은 PENDING이 이어지면 이 시점(폴링 창 시작 기준)에
// 서버에 결제 확인을 요청한다(POST /payments/orders/:orderId/check). 웹훅이 늦거나 빠져도 서버가
// PortOne에 직접 물어 이미 결제됐으면 바로 확정한다. 한 폴링 창에서 최대 3번이고, 서로 10초 이상
// 떨어져 서버의 주문별 조회 간격 하한(10초)에 걸리지 않는다.
export const ORDER_PAYMENT_CHECK_AFTER_MS = [6_000, 20_000, 45_000] as const;

/** 탭이 숨겨져 있으면 주문 상태 폴링을 쉰다(다시 보이면 바로 조회하고 이어 간다). */
export function isDocumentHidden(
  doc: { visibilityState?: string } | undefined = globalThis.document,
): boolean {
  return doc?.visibilityState === 'hidden';
}

/**
 * 다음 폴링 여부. lastStatus는 마지막으로 읽은 주문 상태이고 아직 한 번도 못 읽었으면 null이다
 * (일시 실패도 같은 2분 안에서만 다시 시도한다).
 */
export function shouldPollOrderStatus(lastStatus: OrderStatus | null, elapsedMs: number): boolean {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= ORDER_STATUS_POLL_MAX_MS) {
    return false;
  }
  return lastStatus === null || lastStatus === 'PENDING';
}

/** 결제 확인을 요청할 차례인지. checksMade는 이번 폴링 창에서 이미 보낸 결제 확인 수다. */
export function shouldCheckPendingPayment(
  lastStatus: OrderStatus | null,
  elapsedMs: number,
  checksMade: number,
): boolean {
  if (lastStatus !== 'PENDING' || !Number.isFinite(elapsedMs) || elapsedMs < 0) return false;
  if (!Number.isSafeInteger(checksMade) || checksMade < 0) return false;
  const nextAt = ORDER_PAYMENT_CHECK_AFTER_MS[checksMade];
  return nextAt !== undefined && elapsedMs >= nextAt && elapsedMs < ORDER_STATUS_POLL_MAX_MS;
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
  if (status === 'auth') return '로그인이 필요하거나 이 주문을 볼 수 없어요.';
  if (status === 'network') return '네트워크 연결을 확인하고 다시 시도해 주세요.';
  return '주문 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
}

interface UseOrderStatusResult {
  order: Order | null;
  loading: boolean;
  error: string | null;
  status: OrderDetailReadStatus;
  /** PENDING 주문을 2분 동안 다시 확인했지만 아직 결제 확인 전이라 자동 확인을 멈췄다. */
  pollingExpired: boolean;
  refetch: () => Promise<Order | null | undefined>;
}

interface UseOrderStatusOptions {
  /** PENDING이 이어지면 서버에 결제 확인을 요청한다(결제 완료·주문 상세 화면). */
  checkPendingPayment?: boolean;
}

export function useOrderStatus(
  orderId: string | null,
  accessToken?: string | null,
  options: UseOrderStatusOptions = {},
): UseOrderStatusResult {
  const checkPendingPayment = options.checkPendingPayment === true;
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<OrderDetailReadStatus>('loading');
  const [pollingExpired, setPollingExpired] = useState(false);
  const fetchOrderRef = useRef<(() => Promise<Order | null | undefined>) | null>(null);
  const refetch = useCallback(() => fetchOrderRef.current?.() ?? Promise.resolve(undefined), []);

  useEffect(() => {
    setPollingExpired(false);
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
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let pollStartedAt = Date.now();
    let lastStatus: OrderStatus | null = null;
    // 숨김 탭이라 다음 확인을 미뤘다. 다시 보이면 바로 확인한다.
    let pollDeferredWhileHidden = false;
    // 이번 폴링 창에서 보낸 결제 확인 수와 진행 중인 결제 확인(한 번에 하나만 보낸다).
    let paymentChecksMade = 0;
    let paymentCheckController: AbortController | null = null;

    // 결제 확인은 주문 상태 폴링을 막지 않는다. 결과는 무시하고, 서버가 확정했다고 답하면 바로 다시 읽는다.
    // 실패·시간 초과는 손님에게 따로 알리지 않는다(기존 폴링과 다시 확인 안내가 그대로 이어진다).
    function maybeCheckPendingPayment() {
      if (!checkPendingPayment || paymentCheckController || !accessToken || !orderId) return;
      if (!shouldCheckPendingPayment(lastStatus, Date.now() - pollStartedAt, paymentChecksMade)) {
        return;
      }
      paymentChecksMade += 1;
      const controller = new AbortController();
      paymentCheckController = controller;
      fetch(`${getApiBaseUrl()}/payments/orders/${encodeURIComponent(orderId)}/check`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) return;
          const body = (await res.json().catch(() => null)) as { status?: unknown } | null;
          if (cancelled || controller.signal.aborted) return;
          if (typeof body?.status === 'string' && body.status !== 'PENDING') void fetchOrder();
        })
        .catch(() => undefined)
        .finally(() => {
          if (paymentCheckController === controller) paymentCheckController = null;
        });
    }

    function stopPolling() {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
      pollDeferredWhileHidden = false;
    }

    // 최신 응답을 반영한 뒤에만 다음 확인을 예약한다(요청이 겹치지 않는다).
    function scheduleNextPoll() {
      stopPolling();
      if (cancelled) return;
      if (shouldPollOrderStatus(lastStatus, Date.now() - pollStartedAt)) {
        if (isDocumentHidden()) {
          pollDeferredWhileHidden = true;
          return;
        }
        pollTimer = setTimeout(() => void fetchOrder(), ORDER_STATUS_POLL_INTERVAL_MS);
        return;
      }
      if (lastStatus === 'PENDING') setPollingExpired(true);
    }

    async function fetchOrder(): Promise<Order | null | undefined> {
      const sequence = ++requestSequence;
      stopPolling();
      // PENDING이 이어진 폴링 차례면 주문 조회와 함께 결제 확인도 보낸다(조회를 기다리게 하지 않는다).
      maybeCheckPendingPayment();
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
          }
          setError(message);
          setLoading(false);
          setStatus(failure);
          // 404·권한 오류는 다시 확인하지 않고, 일시 실패만 같은 2분 안에서 다시 시도한다.
          if (failure !== 'auth') scheduleNextPoll();
          return undefined;
        }

        const data = await res.json();
        if (cancelled || sequence !== requestSequence) return undefined;
        const latestOrder = data as Order;
        setOrder(latestOrder);
        setLoading(false);
        setError(null);
        setStatus('found');
        lastStatus = latestOrder.status;
        scheduleNextPoll();
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
        scheduleNextPoll();
        return undefined;
      }
    }

    // 화면의 다시 확인: 바로 새로 읽고, 아직 PENDING이면 2분 동안 다시 자동 확인한다.
    function refetchOrder(): Promise<Order | null | undefined> {
      pollStartedAt = Date.now();
      paymentChecksMade = 0;
      setPollingExpired(false);
      return fetchOrder();
    }

    // 숨김 탭에서는 예약된 확인을 멈춘다. 다시 보이면 미뤄 둔 확인을 바로 하고 폴링을 이어 간다.
    // 폴링을 끝낸 주문(PENDING 아님·404·권한 오류·2분 경과)은 다시 보여도 새로 읽지 않는다.
    function handleVisibilityChange() {
      if (isDocumentHidden()) {
        if (!pollTimer) return;
        stopPolling();
        pollDeferredWhileHidden = true;
        return;
      }
      if (cancelled || !pollDeferredWhileHidden) return;
      void fetchOrder();
    }

    fetchOrderRef.current = refetchOrder;
    globalThis.document?.addEventListener('visibilitychange', handleVisibilityChange);
    void fetchOrder();
    return () => {
      cancelled = true;
      requestSequence += 1;
      activeController?.abort();
      paymentCheckController?.abort();
      if (fetchOrderRef.current === refetchOrder) fetchOrderRef.current = null;
      globalThis.document?.removeEventListener('visibilitychange', handleVisibilityChange);
      stopPolling();
    };
  }, [orderId, accessToken, checkPendingPayment]);

  return { order, loading, error, status, pollingExpired, refetch };
}
