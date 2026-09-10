'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { todayKST } from '@greenhub/shared';
import { db } from '@/lib/firebase';
import type { DailyCap } from '@greenhub/shared';

interface UseDailyCapResult {
  dailyCap: DailyCap | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  isStale: boolean;
  hasLoaded: boolean;
  retry: () => void;
  remainingSlots: number;
}

/**
 * @param storeId  - 스토어 ID
 * @param date     - 'YYYY-MM-DD' 형식. 미전달 시 오늘 날짜 사용
 */
export function useDailyCap(storeId: string | null, date?: string): UseDailyCapResult {
  const [dailyCap, setDailyCap] = useState<DailyCap | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const prevScopeRef = useRef<string | null>(null);
  const hasLoadedRef = useRef(false);

  const retry = useCallback(() => {
    setRefreshing(true);
    setRetryCount((c) => c + 1);
  }, []);

  const resolvedDate = date ?? todayKST();
  const docId = storeId ? `${storeId}_${resolvedDate}` : null;

  useEffect(() => {
    // retryCount는 의도적인 수동 재구독 트리거다: 아래 void 참조로 effect와 명시적으로 연결한다.
    void retryCount;
    if (!docId) {
      prevScopeRef.current = null;
      hasLoadedRef.current = false;
      setDailyCap(null);
      setError(null);
      setIsStale(false);
      setHasLoaded(false);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (prevScopeRef.current !== docId) {
      prevScopeRef.current = docId;
      hasLoadedRef.current = false;
      setDailyCap(null);
      setError(null);
      setIsStale(false);
      setHasLoaded(false);
      setLoading(true);
      setRefreshing(false);
    }

    const ref = doc(db, 'dailyCaps', docId);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setDailyCap(snap.data() as DailyCap);
        } else {
          // 성공한 empty(문서 없음)는 read failure와 다르다: error 없이 null로 확정한다.
          setDailyCap(null);
        }
        hasLoadedRef.current = true;
        setHasLoaded(true);
        setLoading(false);
        setRefreshing(false);
        setError(null);
        setIsStale(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
        setRefreshing(false);
        if (hasLoadedRef.current) {
          // 이전 성공 데이터는 정보 표시용으로 보존하되 반드시 stale로 표시한다.
          setIsStale(true);
        } else {
          setIsStale(false);
          setDailyCap(null);
        }
      },
    );

    return unsubscribe;
  }, [docId, retryCount]);

  // usedSlots는 주문이 들어와 트랜잭션이 써야 비로소 생기는 필드 — ?? 0 널 병합 필수
  const remainingSlots = dailyCap ? computeRemainingSlots(dailyCap.totalCap, dailyCap.usedSlots) : 0;

  return { dailyCap, loading, refreshing, error, isStale, hasLoaded, retry, remainingSlots };
}

/** Firestore usedSlots 누락 대비 순수 잔여 계산 — hook과 테스트가 공유한다. */
export function computeRemainingSlots(totalCap: number, usedSlots?: number | null): number {
  return totalCap - (usedSlots ?? 0);
}

export interface DeliverySlot {
  date: string; // 'YYYY-MM-DD'
  totalCap: number;
  usedSlots: number;
  remainingSlots: number;
}

interface UseDeliverySlotsResult {
  slots: Record<string, DeliverySlot>;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  isStale: boolean;
  hasLoaded: boolean;
  retry: () => void;
}

/**
 * 소비자 배송일 picker용 — 날짜 범위의 dailyCaps 문서를 한 번에 구독한다.
 * REST `daily-caps` API는 셀러 전용 가드(@Roles)라 소비자가 호출 불가하므로
 * Firestore `dailyCaps` 컬렉션을 직접 쿼리한다 (보안 규칙 read: true).
 *
 * @param storeId - 스토어 ID
 * @param from    - 조회 시작일 'YYYY-MM-DD' (inclusive)
 * @param to      - 조회 종료일 'YYYY-MM-DD' (inclusive)
 */
export function useDeliverySlots(
  storeId: string | null,
  from: string,
  to: string,
): UseDeliverySlotsResult {
  const [slots, setSlots] = useState<Record<string, DeliverySlot>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const prevScopeRef = useRef<string | null>(null);
  const hasLoadedRef = useRef(false);

  const retry = useCallback(() => {
    setRefreshing(true);
    setRetryCount((c) => c + 1);
  }, []);

  useEffect(() => {
    // retryCount는 의도적인 수동 재구독 트리거다: 아래 void 참조로 effect와 명시적으로 연결한다.
    void retryCount;
    if (!storeId) {
      prevScopeRef.current = null;
      hasLoadedRef.current = false;
      setSlots({});
      setError(null);
      setIsStale(false);
      setHasLoaded(false);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const scopeKey = `${storeId}|${from}|${to}`;
    if (prevScopeRef.current !== scopeKey) {
      // SCOPE CHANGE: 이전 scope slots를 새 범위 데이터로 재사용하지 않는다.
      prevScopeRef.current = scopeKey;
      hasLoadedRef.current = false;
      setSlots({});
      setError(null);
      setIsStale(false);
      setHasLoaded(false);
      setLoading(true);
      setRefreshing(false);
    }

    const q = query(
      collection(db, 'dailyCaps'),
      where('storeId', '==', storeId),
      where('date', '>=', from),
      where('date', '<=', to),
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const entries = snap.docs.map((docSnap) => docSnap.data() as DailyCap);
        // 성공한 empty(문서 0개)는 error 없이 {}로 확정한다.
        setSlots(buildDeliverySlotsMap(entries));
        hasLoadedRef.current = true;
        setHasLoaded(true);
        setLoading(false);
        setRefreshing(false);
        setError(null);
        setIsStale(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
        setRefreshing(false);
        if (hasLoadedRef.current) {
          // 이전 성공 slots는 정보 표시용으로 보존하되 반드시 stale로 표시한다.
          setIsStale(true);
        } else {
          setIsStale(false);
          setSlots({});
        }
      },
    );

    return unsubscribe;
  }, [storeId, from, to, retryCount]);

  return { slots, loading, refreshing, error, isStale, hasLoaded, retry };
}

/**
 * Firestore snapshot → DeliverySlot map 순수 변환.
 * usedSlots 누락은 ?? 0으로 처리한다. hook 본체와 테스트가 공유하는 최소 primitive다.
 */
export function buildDeliverySlotsMap(
  entries: Array<{ date: string; totalCap: number; usedSlots?: number | null }>,
): Record<string, DeliverySlot> {
  const map: Record<string, DeliverySlot> = {};
  for (const entry of entries) {
    const usedSlots = entry.usedSlots ?? 0;
    map[entry.date] = {
      date: entry.date,
      totalCap: entry.totalCap,
      usedSlots,
      remainingSlots: entry.totalCap - usedSlots,
    };
  }
  return map;
}

/**
 * 배송일 선택 fail-closed 게이트 순수 판정.
 * readBlocked(초기 실패·stale·loading·refreshing 중 하나)면 이전 remainingSlots 값과
 * 무관하게 새 선택을 허용하지 않는다. 기존 선택 value 해소는 호출자가 담당한다.
 */
export function isDeliveryDateSelectable(
  date: string,
  todayStr: string,
  slot: DeliverySlot | undefined,
  readBlocked: boolean,
): boolean {
  if (readBlocked) return false;
  if (date < todayStr) return false;
  if (!slot) return false;
  return slot.remainingSlots > 0;
}
