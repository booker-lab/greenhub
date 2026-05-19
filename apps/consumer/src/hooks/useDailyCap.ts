'use client';

import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { DailyCap } from '@greenhub/shared';

interface UseDailyCapResult {
  dailyCap: DailyCap | null;
  loading: boolean;
  error: string | null;
  remainingSlots: number;
}

/**
 * @param storeId  - 스토어 ID
 * @param date     - 'YYYY-MM-DD' 형식. 미전달 시 오늘 날짜 사용
 */
export function useDailyCap(storeId: string | null, date?: string): UseDailyCapResult {
  const [dailyCap, setDailyCap] = useState<DailyCap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resolvedDate = date ?? new Date().toISOString().split('T')[0];
  const docId = storeId ? `${storeId}_${resolvedDate}` : null;

  useEffect(() => {
    if (!docId) {
      setLoading(false);
      return;
    }

    const ref = doc(db, 'dailyCaps', docId);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setDailyCap(snap.data() as DailyCap);
        } else {
          setDailyCap(null);
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [docId]);

  // usedSlots는 주문이 들어와 트랜잭션이 써야 비로소 생기는 필드 — ?? 0 널 병합 필수
  const remainingSlots = dailyCap ? dailyCap.totalCap - (dailyCap.usedSlots ?? 0) : 0;

  return { dailyCap, loading, error, remainingSlots };
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
  error: string | null;
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(
      collection(db, 'dailyCaps'),
      where('storeId', '==', storeId),
      where('date', '>=', from),
      where('date', '<=', to),
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const map: Record<string, DeliverySlot> = {};
        for (const docSnap of snap.docs) {
          const data = docSnap.data() as DailyCap;
          const usedSlots = data.usedSlots ?? 0;
          map[data.date] = {
            date: data.date,
            totalCap: data.totalCap,
            usedSlots,
            remainingSlots: data.totalCap - usedSlots,
          };
        }
        setSlots(map);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [storeId, from, to]);

  return { slots, loading, error };
}
