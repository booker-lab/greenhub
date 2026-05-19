'use client';

import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import type { GroupConfigMap } from '@/app/orders/_constants';
import { db } from '@/lib/firebase';

/**
 * productId 리스트의 groupProductConfig 문서를 일괄 fetch해 productId → { groupDeliveryDate }
 * 맵으로 반환. 중복 productId는 Set으로 제거 후 Promise.all로 병렬 fetch.
 * Firestore Timestamp는 ISO 문자열로 정규화 (useGroupProduct와 동일 패턴).
 */
export function useGroupConfigs(productIds: string[], enabled: boolean): GroupConfigMap {
  const [map, setMap] = useState<GroupConfigMap>({});
  // 의존성 안정화를 위해 정렬된 join key 사용
  const key = enabled ? [...new Set(productIds)].sort().join('|') : '';

  useEffect(() => {
    if (!enabled || !key) {
      setMap({});
      return;
    }
    const ids = key.split('|').filter(Boolean);
    if (ids.length === 0) {
      setMap({});
      return;
    }

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        ids.map(async (productId) => {
          const snap = await getDoc(doc(db, 'groupProductConfig', productId));
          if (!snap.exists()) return [productId, null] as const;
          const data = snap.data() as { groupDeliveryDate?: unknown };
          const raw = data.groupDeliveryDate;
          // Firestore Timestamp → ISO 정규화
          const iso =
            raw && typeof raw === 'object' && 'toDate' in raw
              ? (raw as { toDate(): Date }).toDate().toISOString()
              : typeof raw === 'string'
                ? raw
                : null;
          return [productId, iso] as const;
        }),
      );
      if (cancelled) return;
      const next: GroupConfigMap = {};
      for (const [productId, iso] of entries) {
        if (iso) next[productId] = { groupDeliveryDate: iso };
      }
      setMap(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [key, enabled]);

  return map;
}
