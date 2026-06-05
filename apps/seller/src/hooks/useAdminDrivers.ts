'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';

export type DriverStatus = 'all' | 'pending' | 'approved' | 'suspended';
export type DriverSort = 'createdAt_desc' | 'createdAt_asc';

export interface AdminDriver {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  vehicleType?: string | null;
  vehicleNumber?: string | null;
  driverApproved: boolean;
  suspended?: boolean;
  createdAt: unknown;
}

interface AdminDriversResponse {
  drivers?: AdminDriver[];
  nextCursor?: string | null;
}

function withQuery(base: string, params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  const str = qs.toString();
  return str ? `${base}?${str}` : base;
}

async function runAction(
  token: string | undefined,
  path: string,
  options: RequestInit,
): Promise<boolean> {
  if (!token) return false;
  try {
    await apiJson(path, token, options);
    return true;
  } catch {
    return false;
  }
}

export function useAdminDrivers(filters: {
  status: DriverStatus;
  sort?: DriverSort;
  limit?: number;
}) {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [drivers, setDrivers] = useState<AdminDriver[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sort = filters.sort ?? 'createdAt_desc';
  const limit = String(filters.limit ?? 100);

  const buildPath = useCallback(
    (cursor?: string | null) =>
      withQuery('/admin/drivers', {
        status: filters.status === 'all' ? undefined : filters.status,
        sort,
        limit,
        cursor: cursor ?? undefined,
      }),
    [filters.status, sort, limit],
  );

  const load = useCallback(
    async (cursor?: string | null) => {
      if (!token) return;
      const append = Boolean(cursor);
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const data = await apiJson<AdminDriversResponse>(buildPath(cursor), token);
        setDrivers((current) =>
          append ? [...current, ...(data.drivers ?? [])] : (data.drivers ?? []),
        );
        setNextCursor(data.nextCursor ?? null);
        setError(null);
      } catch {
        if (!append) {
          setDrivers([]);
          setNextCursor(null);
        }
        setError('드라이버 목록 조회 중 오류 발생');
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [buildPath, token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (userId: string) => {
    const ok = await runAction(token, `/admin/drivers/${userId}/approve`, { method: 'PATCH' });
    if (ok) await load();
    return ok;
  };

  const toggleSuspend = async (userId: string, suspended: boolean) => {
    const ok = await runAction(token, `/admin/drivers/${userId}/suspend`, {
      method: 'PATCH',
      body: JSON.stringify({ suspended }),
    });
    if (ok) await load();
    return ok;
  };

  return {
    drivers,
    loading,
    loadingMore,
    error,
    hasMore: Boolean(nextCursor),
    reload: () => load(),
    loadMore: () => load(nextCursor),
    approve,
    toggleSuspend,
  };
}
