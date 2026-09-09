'use client';

import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { GroupProductConfig } from '@greenhub/shared';

interface UseGroupProductResult {
  config: GroupProductConfig | null;
  loading: boolean;
  error: string | null;
  /**
   * Firestore authoritative snapshot에서 문서가 실제로 없다고 확인된 상태.
   * read failure(error !== null)와 반드시 구분된다.
   */
  isMissing: boolean;
  /** onSnapshot fatal error 이후 명시적 재구독. */
  retry: () => void;
}

export function useGroupProduct(productId: string | null): UseGroupProductResult {
  const [config, setConfig] = useState<GroupProductConfig | null>(null);
  const [loading, setLoading] = useState(() => productId != null);
  const [error, setError] = useState<string | null>(null);
  const [isMissing, setIsMissing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    if (!productId) return;
    // 재구독 전 fail-closed 유지: loading으로 구매 판정 대기, 이전 error/missing 확정 해제.
    // config는 effect 재구독 시 scope 기준으로 정리되며, 비동기 listener 실패 콜백은
    // 기존 config를 지우지 않고 error만 세워 최신 read failure를 무시하지 않게 한다.
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

    // scope 진입/변경/retry: 이전 scope 확정(config/error/missing)을 새 것처럼 보이지 않게 한다.
    setConfig(null);
    setError(null);
    setIsMissing(false);
    setLoading(true);

    const ref = doc(db, 'groupProductConfig', productId);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          // Firestore Timestamp → ISO string 변환
          if (data.recruitDeadline?.toDate)
            data.recruitDeadline = data.recruitDeadline.toDate().toISOString();
          if (data.groupDeliveryDate?.toDate)
            data.groupDeliveryDate = data.groupDeliveryDate.toDate().toISOString();
          setConfig(data as GroupProductConfig);
          setIsMissing(false);
        } else {
          // authoritative missing: 실제로 문서가 없음 (read failure와 구분).
          setConfig(null);
          setIsMissing(true);
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        // read failure: missing으로 위장하지 않는다. config는 표시용으로 유지될 수
        // 있으나 error가 최신 상태이므로 구매 판정은 fail-closed여야 한다.
        setError(err.message);
        setLoading(false);
        setIsMissing(false);
      },
    );

    return unsubscribe;
  }, [productId, attempt]);

  return { config, loading, error, isMissing, retry };
}
