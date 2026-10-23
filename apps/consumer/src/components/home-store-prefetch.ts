'use client';

import { useEffect } from 'react';
import { loadPublicSaleRoundsState } from '@/hooks/useSaleRounds';
import { fetchStoreReviewStats } from '@/lib/benchmark-api';
import { isFeatureOn } from '@/lib/features';
import { fetchPublicStoreProfile } from '@/lib/public-store-profile';

/**
 * 홈이 판매 방식·회차를 미리 조회할 매장. 상품 목록으로 확정한 매장이 없으면 주소의 storeId를 쓴다.
 * 미리 조회일 뿐이라 화면에 보일 매장 판정(resolveHomeStoreId)은 바꾸지 않는다.
 */
export function homePrefetchStoreId(
  resolvedStoreId: string | null,
  requestedStoreId: string | null,
): string | null {
  return resolvedStoreId || requestedStoreId || null;
}

/**
 * 매장 공개 프로필(판매 방식)·공개 회차·상품 별점 조회를 함께 시작한다.
 * 세 조회는 lib/shared-request로 공유되므로 홈의 판매 방식 확인·useSaleRounds·useReviewStats가
 * 이 요청을 그대로 받는다(회차 판매 매장은 요청 수 그대로, legacy 매장은 쓰지 않는 회차·별점 조회가 늘어난다).
 */
export function prefetchHomeStore(storeId: string): void {
  // 실패는 화면 쪽 조회가 다시 받아 처리하므로 여기서는 삼킨다.
  void fetchPublicStoreProfile(storeId).catch(() => {});
  void loadPublicSaleRoundsState(storeId);
  if (isFeatureOn('reviews')) void fetchStoreReviewStats(storeId).catch(() => {});
}

/** storeId가 정해지면(바뀌면) 한 번 미리 조회한다. */
export function useHomeStorePrefetch(storeId: string | null): void {
  useEffect(() => {
    if (storeId) prefetchHomeStore(storeId);
  }, [storeId]);
}

/** 서버가 넘긴 단서(app/home-server.ts)로 홈 첫 조회를 상품 목록과 함께 시작한다. 화면에는 아무것도 그리지 않는다. */
export function HomeStorePrefetch({ storeId }: { storeId: string }) {
  useHomeStorePrefetch(storeId);
  return null;
}
