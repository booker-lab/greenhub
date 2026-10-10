'use client';

import type { SalesMode, StorePublicProfile } from '@greenhub/shared';
import { normalizeSalesMode } from '@greenhub/shared';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { sharedRequest } from '@/lib/shared-request';

export type { StorePublicProfile };

export class PublicStoreProfileNotFoundError extends Error {
  constructor(storeId: string) {
    super(`스토어를 찾을 수 없습니다: ${storeId}`);
    this.name = 'PublicStoreProfileNotFoundError';
  }
}

// 판매 방식·이름·로고는 자주 바뀌지 않는다. 한 화면 안의 하단 메뉴·목록·상품 화면이 같은
// 프로필을 함께 쓰도록 잠깐 공유한다.
const PROFILE_SHARE_MS = 60_000;

/**
 * Public store profile API — single consumer-side owner for
 * GET /stores/:storeId/public-profile.
 * Returns exactly { id, name, logoUrl, salesMode }.
 * 404 → PublicStoreProfileNotFoundError (missing, not network failure).
 */
export async function fetchPublicStoreProfile(
  storeId: string,
  signal?: AbortSignal,
): Promise<StorePublicProfile> {
  const shared = sharedRequest(
    `public-profile:${storeId}`,
    () => loadPublicStoreProfile(storeId),
    { ttlMs: PROFILE_SHARE_MS },
  );
  if (!signal) return shared;
  // 공유 요청은 한 호출부의 취소로 끊지 않고, 취소한 호출부만 기다림을 멈춘다.
  signal.throwIfAborted();
  return new Promise<StorePublicProfile>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    shared.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function loadPublicStoreProfile(storeId: string): Promise<StorePublicProfile> {
  const res = await fetch(
    `${getApiBaseUrl()}/stores/${encodeURIComponent(storeId)}/public-profile`,
  );
  if (res.status === 404) throw new PublicStoreProfileNotFoundError(storeId);
  if (!res.ok) throw new Error(`스토어 조회 오류: ${res.status}`);
  const payload = (await res.json()) as Record<string, unknown>;
  const salesModeValue = payload['salesMode'];
  const salesMode: SalesMode =
    salesModeValue === 'round_direct' ? 'round_direct' : normalizeSalesMode(undefined);
  return {
    id: String(payload['id'] ?? storeId),
    name: String(payload['name'] ?? ''),
    logoUrl: (payload['logoUrl'] as string | null) ?? null,
    salesMode,
  };
}
