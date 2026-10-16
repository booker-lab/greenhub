'use client';

import type {
  ProductReviewsResponse,
  PurchaseStampsResponse,
  ReviewSummary,
  StorePublicProfile,
  UserCoupon,
} from '@greenhub/shared';
import { signIn, useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import {
  BenchmarkApiError,
  type ClaimableCoupon,
  claimCoupon,
  claimStampReward,
  fetchClaimableCoupons,
  fetchMyCoupons,
  fetchProductReviews,
  fetchRestockSubscriptions,
  fetchStamps,
  fetchStoreReviewStats,
  fetchWishlist,
  setRestockSubscription,
  setWishlist,
} from '@/lib/benchmark-api';
import { fetchPublicStoreProfile } from '@/lib/public-store-profile';

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

type ToggleKind = 'wishlist' | 'restock';

/**
 * 찜·다음 회차 알림 신청 목록. 로그인하지 않았으면 toggle이 로그인으로 보낸다.
 */
export function useProductToggleSet(kind: ToggleKind, enabled: boolean) {
  const { token, status } = useAccessToken();
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !token) {
      setIds(new Set());
      return;
    }
    let active = true;
    const load = kind === 'wishlist' ? fetchWishlist : fetchRestockSubscriptions;
    load(token)
      .then((list) => {
        if (active) setIds(new Set(list ?? []));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [enabled, kind, token]);

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
        await (kind === 'wishlist' ? setWishlist : setRestockSubscription)(token, productId, next);
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
    [ids, kind, status, token],
  );

  return { ids, toggle, pending, signedIn: Boolean(token) };
}

/** 받을 수 있는 쿠폰(공개)과 내 쿠폰(로그인). */
export function useCoupons(storeId: string | null, enabled: boolean) {
  const { token } = useAccessToken();
  const [claimable, setClaimable] = useState<ClaimableCoupon[]>([]);
  const [mine, setMine] = useState<UserCoupon[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || !storeId) return;
    let active = true;
    fetchClaimableCoupons(storeId)
      .then((value) => {
        if (active) setClaimable(value ?? []);
      })
      .catch(() => {});
    if (token) {
      fetchMyCoupons(storeId, token)
        .then((value) => {
          if (active) setMine(value ?? []);
        })
        .catch(() => {});
    } else {
      setMine([]);
    }
    return () => {
      active = false;
    };
  }, [enabled, storeId, token, tick]);

  const claim = useCallback(
    async (couponId: string): Promise<'login' | 'ok' | string> => {
      if (!storeId) return '쿠폰을 받을 수 없어요';
      if (!token) {
        void signIn(undefined, { callbackUrl: window.location.pathname + window.location.search });
        return 'login';
      }
      try {
        await claimCoupon(storeId, couponId, token);
        setTick((n) => n + 1);
        return 'ok';
      } catch (error) {
        return error instanceof BenchmarkApiError ? error.message : '쿠폰을 받지 못했어요';
      }
    },
    [storeId, token],
  );

  const claimedCouponIds = new Set(mine.map((coupon) => coupon.couponId).filter(Boolean));
  return {
    claimable,
    unclaimed: claimable.filter((coupon) => !claimedCouponIds.has(coupon.id)),
    mine,
    available: mine.filter((coupon) => coupon.status === 'available'),
    claim,
    signedIn: Boolean(token),
  };
}

export function useStamps(storeId: string | null, enabled: boolean) {
  const { token } = useAccessToken();
  const [stamps, setStamps] = useState<PurchaseStampsResponse | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || !storeId || !token) {
      setStamps(null);
      return;
    }
    let active = true;
    fetchStamps(storeId, token)
      .then((value) => {
        if (active) setStamps(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [enabled, storeId, token, tick]);

  const claim = useCallback(
    async (at: number) => {
      if (!storeId || !token) return false;
      try {
        await claimStampReward(storeId, at, token);
        setTick((n) => n + 1);
        return true;
      } catch {
        return false;
      }
    },
    [storeId, token],
  );
  return { stamps, claim, signedIn: Boolean(token) };
}
