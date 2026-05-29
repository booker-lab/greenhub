'use client';

import type { OrderStatus, SettlementStatus, StoreStatus } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { type DependencyList, useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';

export { useAdminInvite } from './useAdminInvite';
export type { InviteRevokeReason, InviteToken } from './useAdminInvite';

// ── Types ────────────────────────────────────────────────────────

export interface AdminStore {
  id: string;
  name: string;
  ownerId: string;
  status: StoreStatus;
  commissionRate?: number;
  createdAt: unknown;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  phone?: string;
  suspended?: boolean;
  createdAt: unknown;
}

export interface AdminOrder {
  id: string;
  orderNumber?: string;
  storeId: string;
  userId: string;
  productId?: string;
  productName?: string;
  buyerName?: string;
  buyerPhone?: string | null;
  status: OrderStatus;
  totalAmount: number;
  deliveryMethod: string;
  saleType?: string;
  quantity?: number;
  deliveryAddress?: {
    address?: string;
    addressDetail?: string;
    zipCode?: string;
  } | null;
  address?: string;
  requestedDeliveryDate?: string | null;
  preparedAt?: string | null;
  courierCompany?: string | null;
  trackingNumber?: string | null;
  cancelReason?: string | null;
  createdAt: unknown;
  updatedAt?: unknown;
}

export type AdminOrderSort = 'createdAt_desc' | 'createdAt_asc';

export interface AdminSettlement {
  id: string;
  storeId: string;
  orderId: string;
  totalAmount: number;
  platformFee: number;
  netAmount: number;
  status: SettlementStatus; // N3: string → 공유 SettlementStatus(SSOT)
  settledAt: unknown;
  confirmedAt?: unknown | null; // N8: B-1 confirm 배치 신규 필드(어드민도 표시 대비)
  paidAt: unknown | null;
}

export interface BulkPaySettlementsResult {
  ok: string[];
  failed: { id: string; reason: string }[];
}

export type DriverStatus = 'all' | 'pending' | 'approved' | 'suspended';

export interface AdminDriver {
  id: string;
  name: string;
  email: string | null;
  driverApproved: boolean;
  suspended?: boolean;
  createdAt: unknown;
}

export interface BannerCta {
  label: string;
  href: string;
}

export interface AdminBanner {
  imageUrl?: string;
  tagText?: string;
  headline?: string;
  subText?: string;
  cta1?: BannerCta;
  cta2?: BannerCta;
  isActive?: boolean;
}

// ── Core ─────────────────────────────────────────────────────────

/**
 * 관리자 목록 리소스 공통 훅 — data/loading/error 상태 + 토큰 가드 + 자동 로드.
 * `buildPath`/`extract`는 매 렌더 재생성되므로 deps에 넣지 않는다(필터값만 deps로).
 */
function useAdminList<T>(
  buildPath: () => string,
  extract: (data: unknown) => T[],
  errLabel: string,
  deps: DependencyList = [],
) {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: buildPath/extract/errLabel은 매 렌더 재생성되는 안정 클로저 — reload는 token·필터(deps) 변화로만 트리거한다
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiJson(buildPath(), token);
      setItems(extract(data));
      setError(null);
    } catch {
      setError(`${errLabel} 조회 중 오류 발생`);
    } finally {
      setLoading(false);
    }
  }, [token, ...deps]);

  useEffect(() => {
    load();
  }, [load]);

  return { items, loading, error, reload: load, token };
}

/** 관리자 액션(PATCH/POST/PUT) 실행 — 성공 여부만 boolean으로 반환. */
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

function withQuery(base: string, params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  const str = qs.toString();
  return str ? `${base}?${str}` : base;
}

function pick<T>(key: string) {
  return (data: unknown): T[] => (data as Record<string, T[]>)?.[key] ?? [];
}

interface AdminOrdersResponse {
  orders?: AdminOrder[];
  nextCursor?: string | null;
}

// ── Stores ───────────────────────────────────────────────────────

export function useAdminStores() {
  const {
    items: stores,
    loading,
    error,
    reload,
    token,
  } = useAdminList<AdminStore>(() => '/admin/stores', pick<AdminStore>('stores'), '판매자 목록');

  const setCommission = async (storeId: string, rate: number) => {
    const ok = await runAction(token, `/admin/stores/${storeId}/commission`, {
      method: 'PATCH',
      body: JSON.stringify({ rate }),
    });
    if (ok) await reload();
    return ok;
  };

  // 치우기 — 기록 가드 차단(400) 사유를 UI에 그대로 안내해야 하므로
  // runAction(에러 삼킴) 대신 apiJson을 직접 호출해 ApiError를 전파한다.
  const archiveStore = async (storeId: string) => {
    if (!token) return;
    await apiJson(`/admin/stores/${storeId}/archive`, token, { method: 'PATCH' });
    await reload();
  };

  const restoreStore = async (storeId: string) => {
    if (!token) return;
    await apiJson(`/admin/stores/${storeId}/restore`, token, { method: 'PATCH' });
    await reload();
  };

  return { stores, loading, error, reload, setCommission, archiveStore, restoreStore };
}

// ── Users ────────────────────────────────────────────────────────

export function useAdminUsers() {
  const {
    items: users,
    loading,
    error,
    reload,
    token,
  } = useAdminList<AdminUser>(() => '/admin/users', pick<AdminUser>('users'), '사용자 목록');

  const toggleSuspend = async (userId: string, suspended: boolean) => {
    const ok = await runAction(token, `/admin/users/${userId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ suspended }),
    });
    if (ok) await reload();
    return ok;
  };

  return { users, loading, error, reload, toggleSuspend };
}

// ── Orders ───────────────────────────────────────────────────────

export function useAdminOrders(filters?: {
  storeId?: string;
  status?: OrderStatus;
  sort?: AdminOrderSort;
  limit?: number;
}) {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sort = filters?.sort ?? 'createdAt_desc';
  const limit = String(filters?.limit ?? 50);

  const buildOrdersPath = useCallback(
    (cursor?: string | null) =>
      withQuery('/admin/orders', {
        storeId: filters?.storeId,
        status: filters?.status,
        sort,
        limit,
        cursor: cursor ?? undefined,
      }),
    [filters?.storeId, filters?.status, sort, limit],
  );

  const load = useCallback(
    async (cursor?: string | null) => {
      if (!token) return;
      const append = Boolean(cursor);
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const data = await apiJson<AdminOrdersResponse>(buildOrdersPath(cursor), token);
        setOrders((current) =>
          append ? [...current, ...(data.orders ?? [])] : (data.orders ?? []),
        );
        setNextCursor(data.nextCursor ?? null);
        setError(null);
      } catch {
        setError('주문 목록 조회 중 오류 발생');
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [buildOrdersPath, token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const forceRefund = async (orderId: string, reason?: string) => {
    const ok = await runAction(token, `/admin/orders/${orderId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    if (ok) await load();
    return ok;
  };

  return {
    orders,
    loading,
    loadingMore,
    error,
    hasMore: Boolean(nextCursor),
    reload: () => load(),
    loadMore: () => load(nextCursor),
    forceRefund,
  };
}

// ── Settlements ──────────────────────────────────────────────────

export function useAdminSettlements(filters?: {
  storeId?: string;
  from?: string;
  to?: string;
  status?: SettlementStatus;
}) {
  const {
    items: settlements,
    loading,
    error,
    reload,
    token,
  } = useAdminList<AdminSettlement>(
    () =>
      withQuery('/admin/settlements', {
        storeId: filters?.storeId,
        from: filters?.from,
        to: filters?.to,
        status: filters?.status,
      }),
    pick<AdminSettlement>('settlements'),
    '정산 목록',
    [filters?.storeId, filters?.from, filters?.to, filters?.status],
  );

  const markAsPaid = async (settlementId: string) => {
    const ok = await runAction(token, `/admin/settlements/${settlementId}/pay`, {
      method: 'PATCH',
    });
    if (ok) await reload();
    return ok;
  };

  const bulkMarkAsPaid = async (ids: string[]): Promise<BulkPaySettlementsResult | null> => {
    if (!token || ids.length === 0) return null;
    try {
      const result = await apiJson<BulkPaySettlementsResult>('/admin/settlements/bulk-pay', token, {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      await reload();
      return result;
    } catch {
      return null;
    }
  };

  return { settlements, loading, error, reload, markAsPaid, bulkMarkAsPaid };
}

// ── Drivers ──────────────────────────────────────────────────────

export function useAdminDrivers(filters: { status: DriverStatus }) {
  const {
    items: drivers,
    loading,
    error,
    reload,
    token,
  } = useAdminList<AdminDriver>(
    () =>
      withQuery('/admin/drivers', {
        status: filters.status === 'all' ? undefined : filters.status,
      }),
    pick<AdminDriver>('drivers'),
    '드라이버 목록',
    [filters.status],
  );

  const approve = async (userId: string) => {
    const ok = await runAction(token, `/admin/drivers/${userId}/approve`, { method: 'PATCH' });
    if (ok) await reload();
    return ok;
  };

  const toggleSuspend = async (userId: string, suspended: boolean) => {
    const ok = await runAction(token, `/admin/drivers/${userId}/suspend`, {
      method: 'PATCH',
      body: JSON.stringify({ suspended }),
    });
    if (ok) await reload();
    return ok;
  };

  return { drivers, loading, error, reload, approve, toggleSuspend };
}

// ── Banner ───────────────────────────────────────────────────────

export function useAdminBanner() {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [banner, setBanner] = useState<AdminBanner | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setBanner(await apiJson<AdminBanner>('/admin/banner', token));
    } catch {
      // 배너 미설정 등 — 무시
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (dto: AdminBanner): Promise<boolean> => {
    if (!token) return false;
    setSaving(true);
    // 서버 관리 필드 제거 (forbidNonWhitelisted 대응)
    const {
      updatedAt: _u,
      createdAt: _c,
      ...payload
    } = dto as AdminBanner & Record<string, unknown>;
    try {
      await apiJson('/admin/banner', token, { method: 'PUT', body: JSON.stringify(payload) });
      await load();
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { banner, loading, saving, save, reload: load };
}
