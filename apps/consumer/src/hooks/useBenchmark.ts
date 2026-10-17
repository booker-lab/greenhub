'use client';

import type { ProductReviewsResponse, ReviewSummary, StorePublicProfile } from '@greenhub/shared';
import { signIn, useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import {
  fetchProductReviews,
  fetchRestockSubscriptions,
  fetchStoreReviewStats,
  setRestockSubscription,
} from '@/lib/benchmark-api';
import { fetchPublicStoreProfile } from '@/lib/public-store-profile';
import { readRoundWish, ROUND_WISH_CHANGE_EVENT, toggleRoundWish } from '@/lib/round-wishlist';

// 팔도감 벤치마킹 비교 기능의 화면 상태. enabled=false면 요청을 보내지 않는다.

function useAccessToken(): { token: string | null; status: 'loading' | 'authenticated' | 'unauthenticated' } {
  const { data, status } = useSession();
  return { token: data?.user?.accessToken ?? null, status };
}

/** 판매자 공개 소개까지 담긴 스토어 프로필. */
export function useStoreProfile(storeId: string | null, enabled = true) {
  const [profile, setProfile] = useState<StorePublicProfile | null>(null);
  useEffect(() => {
    if (!enabled || !storeId) {
      setProfile(null);
      return;
    }
    let active = true;
    fetchPublicStoreProfile(storeId)
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch(() => {
        if (active) setProfile(null);
      });
    return () => {
      active = false;
    };
  }, [enabled, storeId]);
  return profile;
}

export function useReviewStats(storeId: string | null, enabled: boolean) {
  const [stats, setStats] = useState<Record<string, ReviewSummary>>({});
  useEffect(() => {
    if (!enabled || !storeId) return;
    let active = true;
    fetchStoreReviewStats(storeId)
      .then((value) => {
        if (active) setStats(value ?? {});
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [enabled, storeId]);
  return stats;
}

export function useProductReviews(productId: string | null, enabled: boolean) {
  const [reviews, setReviews] = useState<ProductReviewsResponse | null>(null);
  useEffect(() => {
    if (!enabled || !productId) return;
    let active = true;
    fetchProductReviews(productId)
      .then((value) => {
        if (active) setReviews(value);
      })
      .catch(() => {
        if (active) setReviews({ summary: { count: 0, average: 0 }, items: [] });
      });
    return () => {
      active = false;
    };
  }, [enabled, productId]);
  return reviews;
}

/**
 * 다음 회차 알림 신청 목록. 로그인하지 않았으면 toggle이 로그인으로 보낸다.
 */
export function useRestockSubscriptions(enabled: boolean) {
  const { token, status } = useAccessToken();
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !token) {
      setIds(new Set());
      return;
    }
    let active = true;
    fetchRestockSubscriptions(token)
      .then((list) => {
        if (active) setIds(new Set(list ?? []));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [enabled, token]);

  const toggle = useCallback(
    async (productId: string): Promise<'login' | 'on' | 'off' | 'error'> => {
      if (!token) {
        if (status !== 'loading') {
          void signIn(undefined, { callbackUrl: window.location.pathname + window.location.search });
        }
        return 'login';
      }
      const next = !ids.has(productId);
      setPending(productId);
      try {
        await setRestockSubscription(token, productId, next);
        setIds((current) => {
          const copy = new Set(current);
          if (next) copy.add(productId);
          else copy.delete(productId);
          return copy;
        });
        return next ? 'on' : 'off';
      } catch {
        return 'error';
      } finally {
        setPending(null);
      }
    },
    [ids, status, token],
  );

  return { ids, toggle, pending, signedIn: Boolean(token) };
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 이번 회차 찜(wishlist). 로그인 없이 이 브라우저에만, 이 회차에만 남는다.
 * 같은 화면의 다른 찜 버튼도 함께 바뀌도록 변경을 알린다.
 */
export function useRoundWishlist(roundId: string | null, enabled: boolean) {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!enabled || !roundId) {
      setIds(new Set());
      return;
    }
    const sync = () => setIds(new Set(readRoundWish(browserStorage(), roundId)));
    sync();
    window.addEventListener(ROUND_WISH_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(ROUND_WISH_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [enabled, roundId]);

  const toggle = useCallback(
    (productId: string) => {
      if (!enabled || !roundId) return;
      setIds(new Set(toggleRoundWish(browserStorage(), roundId, productId)));
      window.dispatchEvent(new Event(ROUND_WISH_CHANGE_EVENT));
    },
    [enabled, roundId],
  );

  return { ids, toggle };
}
