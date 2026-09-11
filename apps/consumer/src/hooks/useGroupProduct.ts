'use client';

import { useCallback, useEffect, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api-base-url';
import type { GroupProductConfig } from '@greenhub/shared';

interface UseGroupProductResult {
  config: GroupProductConfig | null;
  loading: boolean;
  error: string | null;
  /**
   * Public API authoritative 응답에서 문서가 실제로 없다고 확인된 상태.
   * read failure(error !== null)와 반드시 구분된다.
   */
  isMissing: boolean;
  /** fatal error 이후 명시적 재조회. */
  retry: () => void;
}

const API_URL = getApiBaseUrl();
// Public-safe polling: Firestore 원문 onSnapshot 대신 public product detail API를
// 사용한다. Rules convergence 후 익명 원문 read가 차단돼도 동작한다.
// 구매 가능성·currentQuantity freshness를 위해 mount/retry/scope 변경 시 즉시
// 조회하고 10초 간격으로 갱신한다.
const GROUP_CONFIG_POLL_INTERVAL_MS = 10_000;

function toGroupConfig(productId: string, payload: unknown): GroupProductConfig | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const groupConfig = record['groupConfig'];
  if (typeof groupConfig !== 'object' || groupConfig === null) return null;
  const gc = groupConfig as Record<string, unknown>;
  return {
    productId,
    minQuantity: Number(gc['minQuantity'] ?? 0),
    targetQuantity: Number(gc['targetQuantity'] ?? 0),
    maxPerPerson: Number(gc['maxPerPerson'] ?? 0),
    recruitDeadline: String(gc['recruitDeadline'] ?? ''),
    currentQuantity: Number(gc['currentQuantity'] ?? 0),
    groupDeliveryDate: String(gc['groupDeliveryDate'] ?? ''),
    groupDeliveryMethod: gc['groupDeliveryMethod'] === 'parcel' ? 'parcel' : 'direct',
    deliveryFeeDiscount: Number(gc['deliveryFeeDiscount'] ?? 0),
  } as GroupProductConfig;
}

export function useGroupProduct(productId: string | null): UseGroupProductResult {
  const [config, setConfig] = useState<GroupProductConfig | null>(null);
  const [loading, setLoading] = useState(() => productId != null);
  const [error, setError] = useState<string | null>(null);
  const [isMissing, setIsMissing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    if (!productId) return;
    // 재조회 전 fail-closed 유지: loading으로 구매 판정 대기, 이전 error/missing 확정 해제.
    setError(null);
    setIsMissing(false);
    setLoading(true);
    setAttempt((n) => n + 1);
  }, [productId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt는 의도적인 수동 retry 트리거다 — effect 본문에서 직접 읽지 않는다
  useEffect(() => {
    if (!productId) {
      // non-group scope: 이전 group scope의 config/error가 남지 않는다.
      setConfig(null);
      setError(null);
      setIsMissing(false);
      setLoading(false);
      return;
    }

    const targetProductId = productId;

    // scope 진입/변경/retry: 이전 scope 확정(config/error/missing)을 새 것처럼 보이지 않게 한다.
    setConfig(null);
    setError(null);
    setIsMissing(false);
    setLoading(true);

    let cancelled = false;

    async function fetchConfig() {
      try {
        const res = await fetch(
          `${API_URL}/products/${encodeURIComponent(targetProductId)}`,
        );
        if (cancelled) return;
        if (res.status === 404) {
          // authoritative missing/invisible: 비활성·testOnly·삭제·groupConfig 없음과
          // 구분 없이 구매 불가로 fail-closed한다.
          setConfig(null);
          setIsMissing(true);
          setError(null);
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error(`공동구매 조회 오류: ${res.status}`);
        const payload: unknown = await res.json();
        if (cancelled) return;
        const next = toGroupConfig(targetProductId, payload);
        if (!next) {
          setConfig(null);
          setIsMissing(true);
          setError(null);
          setLoading(false);
          return;
        }
        setConfig(next);
        setIsMissing(false);
        setError(null);
        setLoading(false);
      } catch (e: unknown) {
        if (cancelled) return;
        // read failure: missing으로 위장하지 않는다. config는 표시용으로 유지될 수
        // 있으나 error가 최신 상태이므로 구매 판정은 fail-closed여야 한다.
        setError(e instanceof Error ? e.message : '공동구매 조회 실패');
        setLoading(false);
        setIsMissing(false);
      }
    }

    void fetchConfig();
    const intervalId = setInterval(() => {
      void fetchConfig();
    }, GROUP_CONFIG_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [productId, attempt]);

  return { config, loading, error, isMissing, retry };
}
