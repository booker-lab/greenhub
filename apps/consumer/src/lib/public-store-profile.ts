'use client';

import type { SalesMode, StorePublicProfile } from '@greenhub/shared';
import { normalizeSalesMode } from '@greenhub/shared';
import { getApiBaseUrl } from '@/lib/api-base-url';

export type { StorePublicProfile };

export class PublicStoreProfileNotFoundError extends Error {
  constructor(storeId: string) {
    super(`스토어를 찾을 수 없습니다: ${storeId}`);
    this.name = 'PublicStoreProfileNotFoundError';
  }
}

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
  const res = await fetch(
    `${getApiBaseUrl()}/stores/${encodeURIComponent(storeId)}/public-profile`,
    { signal },
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
