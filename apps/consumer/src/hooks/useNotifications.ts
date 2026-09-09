'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import type { Notification } from '@greenhub/shared';
import { getApiBaseUrl } from '@/lib/api-base-url';

const API_URL = getApiBaseUrl();
const LEGACY_READ_KEY = 'gh_read_notifications';

function readKeyFor(userId: string): string {
  return `${LEGACY_READ_KEY}:${userId}`;
}

function parseIdArray(raw: string | null): Set<string> | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function getReadIdsFor(userId: string): Set<string> {
  try {
    const scoped = parseIdArray(localStorage.getItem(readKeyFor(userId)));
    if (scoped !== null) return scoped;
    const legacy = parseIdArray(localStorage.getItem(LEGACY_READ_KEY));
    const ids = legacy ?? new Set<string>();
    try {
      localStorage.setItem(readKeyFor(userId), JSON.stringify([...ids]));
    } catch {
      // ignore migration write failure: in-memory ids still apply
    }
    return ids;
  } catch {
    return new Set();
  }
}

function saveReadIdsFor(userId: string, ids: Set<string>) {
  try {
    localStorage.setItem(readKeyFor(userId), JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

interface UseNotificationsResult {
  notifications: Notification[];
  readIds: Set<string>;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
}

export function useNotifications(): UseNotificationsResult {
  const { data: session } = useSession();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // 최신 요청 식별자: cleanup된 이전 effect의 stale 응답이 최신 결과를 덮지 않게 한다.
  const requestSequenceRef = useRef(0);
  // session/user scope: 이전 사용자의 protected notifications가 새 scope에 노출되지 않게 한다.
  // useOrders의 userId+token scope 격리와 동일한 계약이다.
  const prevScopeRef = useRef<string | null>(null);

  const refetch = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    // tick은 의도적인 수동 refetch 트리거다: 아래 void 참조로 effect와 명시적으로 연결한다.
    void tick;
    const userId = session?.user?.id;
    const token = session?.user?.accessToken;
    const scopeKey = userId && token ? `${userId}\0${token}` : null;
    if (!userId || !token || !scopeKey) {
      prevScopeRef.current = null;
      setNotifications([]);
      setReadIds(new Set());
      setError(null);
      setLoading(false);
      return;
    }

    if (prevScopeRef.current !== scopeKey) {
      prevScopeRef.current = scopeKey;
      setNotifications([]);
      setError(null);
      setReadIds(getReadIdsFor(userId));
    }

    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    let cancelled = false;
    setLoading(true);

    async function fetchNotifications() {
      try {
        const res = await fetch(`${API_URL}/notifications/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled || requestSequenceRef.current !== requestId) return;
        if (!res.ok) throw new Error(`조회 오류: ${res.status}`);
        const data = await res.json();
        if (cancelled || requestSequenceRef.current !== requestId) return;
        // 성공만 상태를 교체한다: error clear + 정상 empty([])도 성공으로 확정한다.
        setNotifications(data.items ?? []);
        setError(null);
        setLoading(false);
      } catch (e: unknown) {
        if (cancelled || requestSequenceRef.current !== requestId) return;
        // 실패는 기존 성공 데이터를 삭제하지 않는다: notifications 유지, error만 교체한다.
        // previous success + refresh failure는 stale list + failure로 표현된다.
        setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
        setLoading(false);
      }
    }

    fetchNotifications();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, session?.user?.accessToken, tick]);

  const markRead = useCallback(
    (id: string) => {
      const userId = session?.user?.id;
      if (!userId) return;
      setReadIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        saveReadIdsFor(userId, next);
        return next;
      });
    },
    [session?.user?.id],
  );

  const markAllRead = useCallback(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    setReadIds((prev) => {
      const next = new Set(prev);
      notifications.forEach((notification) => {
        next.add(notification.id);
      });
      saveReadIdsFor(userId, next);
      return next;
    });
  }, [notifications, session?.user?.id]);

  return { notifications, readIds, loading, error, refetch, markAllRead, markRead };
}
