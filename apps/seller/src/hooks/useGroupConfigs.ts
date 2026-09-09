'use client';

import { doc, getDoc } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GroupConfigMap } from '@/app/orders/_constants';
import { db } from '@/lib/firebase';
import {
  buildGroupConfigKey,
  fetchGroupConfigMap,
  GROUP_CONFIGS_ERROR_MESSAGE,
  isGroupConfigStale,
  normalizeGroupDeliveryDate,
  shouldIgnoreGroupConfigResponse,
} from './useGroupConfigs.recovery';

export {
  buildGroupConfigKey,
  dedupeGroupProductIds,
  fetchGroupConfigMap,
  GROUP_CONFIGS_ERROR_MESSAGE,
  isGroupConfigStale,
  nextGroupConfigRetryKey,
  normalizeGroupDeliveryDate,
  resolveGroupConfigMapAfterFailure,
  resolveGroupConfigView,
  shouldIgnoreGroupConfigResponse,
} from './useGroupConfigs.recovery';
export type { GroupConfigEntry, GroupConfigMapData, GroupConfigView } from './useGroupConfigs.recovery';

/**
 * productId 리스트의 groupProductConfig 문서를 일괄 fetch하는 auxiliary read.
 *
 * 이 데이터는 "주문 자체"가 아니라 공동구매 배송일 그룹화/표시용 보조 메타데이터다.
 * 따라서 core order read를 가리지 않는다:
 * - 실패해도 unhandled rejection 없이 error + retry로 닫고, core 목록은 호출부가 유지한다.
 * - 문서 없음(missing)은 실패가 아니라 map 제외다.
 * - 이전 성공 뒤 같은 scope 재조회 실패는 이전 map을 stale로 보존한다.
 * - scope(product ID set) 변경 시 이전 scope 데이터를 새 값처럼 노출하지 않고,
 *   늦은 응답이 새 scope를 덮지 않는다.
 */
export interface UseGroupConfigsResult {
  /** 마지막 authoritative 성공 map. 실패 시 이전 map(stale) 또는 `{}`. */
  map: GroupConfigMap;
  /** 조회 중 여부. stale background 갱신 중에도 true가 될 수 있다. */
  loading: boolean;
  /** 보조 조회 실패 메시지. 성공·disabled·로딩 시작 시 null. */
  error: string | null;
  /** error + 이전 성공. 최신 확정값이 아니므로 주문 존재/상태 판단에 쓰지 않는다. */
  isStale: boolean;
  /** 같은 scope를 다시 조회한다. saleType/tab/filter state를 건드리지 않는다. */
  retry: () => void;
}

export function useGroupConfigs(productIds: string[], enabled: boolean): UseGroupConfigsResult {
  const [map, setMap] = useState<GroupConfigMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const requestIdRef = useRef(0);
  const scopeRef = useRef<string>('');

  // 의존성 안정화를 위해 정렬된 join key 사용 (dedupe 포함)
  const key = buildGroupConfigKey(productIds, enabled);

  const retry = useCallback(() => {
    setRetryKey((k) => k + 1);
  }, []);

  const isStale = isGroupConfigStale(error, hasLoaded);

  useEffect(() => {
    void retryKey;
    if (!enabled || !key) {
      // A. Disabled / no IDs — map/error/loading clean state.
      requestIdRef.current += 1;
      scopeRef.current = '';
      setMap({});
      setError(null);
      setLoading(false);
      setHasLoaded(false);
      return;
    }
    const ids = key.split('|').filter(Boolean);
    if (ids.length === 0) {
      requestIdRef.current += 1;
      scopeRef.current = '';
      setMap({});
      setError(null);
      setLoading(false);
      setHasLoaded(false);
      return;
    }

    const isScopeChange = scopeRef.current !== key;
    scopeRef.current = key;
    if (isScopeChange) {
      // 새 scope는 이전 scope 데이터를 authoritative처럼 노출하지 않는다.
      setMap({});
      setHasLoaded(false);
    }
    // 같은 scope retry는 이전 map을 유지한 채 background 갱신한다.
    setError(null);
    setLoading(true);
    const myId = requestIdRef.current + 1;
    requestIdRef.current = myId;
    const scopeKey = key;
    let active = true;

    (async () => {
      let next: GroupConfigMap | null = null;
      let failed = false;
      try {
        next = await fetchGroupConfigMap(ids, async (productId) => {
          const snap = await getDoc(doc(db, 'groupProductConfig', productId));
          if (!snap.exists()) return null;
          const data = snap.data() as { groupDeliveryDate?: unknown };
          return normalizeGroupDeliveryDate(data.groupDeliveryDate);
        });
      } catch {
        failed = true;
      }
      if (shouldIgnoreGroupConfigResponse(active, requestIdRef.current, myId)) return;
      if (scopeRef.current !== scopeKey) return;
      if (failed || next === null) {
        // D/E. 실패는 이전 map을 지우지 않는다 (stale 보존, EMPTY collapse 금지).
        // 단순 `.catch(() => setMap({}))` 금지 — READ_FAILED를 EMPTY로 승격시키기 때문이다.
        setError(GROUP_CONFIGS_ERROR_MESSAGE);
        setLoading(false);
        return;
      }
      setMap(next);
      setError(null);
      setHasLoaded(true);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [key, enabled, retryKey]);

  return { map, loading, error, isStale, retry };
}
