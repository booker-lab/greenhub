'use client';

import type { SettlementStatus, StoreStatus } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { type DependencyList, useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/api';
import {
  type AdminCommandOutcome,
  executeAdminCommand,
} from './useAdmin.outcome';

export type { AdminCommandOutcome } from './useAdmin.outcome';
export { classifyAdminCommandError, describeAdminCommandOutcome } from './useAdmin.outcome';

/** archive/restore처럼 ApiError를 직접 전파하는 경로의 reconciliation 결과. */
export interface AdminReconciliation {
  reconciled: boolean;
  readError: string | null;
}

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
  status: string;
  totalAmount: number;
  deliveryMethod: string;
  createdAt: unknown;
}

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

export interface InviteToken {
  token: string;
  createdBy: string;
  usedAt: string | null;
  usedBy: string | null;
  expiresAt: string | null;
  createdAt: string | null;
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
  const load = useCallback(async (): Promise<string | null> => {
    if (!token) return '인증 토큰이 없습니다. 다시 로그인해 주세요.';
    setLoading(true);
    try {
      const data = await apiJson(buildPath(), token);
      setItems(extract(data));
      setError(null);
      return null;
    } catch {
      const readError = `${errLabel} 조회 중 오류 발생`;
      setError(readError);
      return readError;
    } finally {
      setLoading(false);
    }
  }, [token, ...deps]);

  useEffect(() => {
    load();
  }, [load]);

  return { items, loading, error, reload: load, token };
}

/**
 * 관리자 액션(PATCH/POST/PUT) 실행 — boolean 축약 없이 outcome으로 반환한다.
 * - 2xx + reload 성공: confirmed/reconciled.
 * - 2xx + reload 실패: confirmed/stale (command 실패로 되돌리지 않음, readError 보존).
 * - 4xx ApiError: rejected (서버 reason/status 보존).
 * - 5xx ApiError·transport: unknown (재확인 우선, blind retry 금지).
 * reload 실패는 기존 list error state에도 남는다 (load가 소유).
 */
async function runAdminCommand(
  token: string | undefined,
  path: string,
  options: RequestInit,
  reload: () => Promise<string | null>,
): Promise<AdminCommandOutcome> {
  return executeAdminCommand({
    missingToken: !token,
    invoke: () => apiJson(path, token as string, options).then(() => undefined),
    reload,
  });
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

// ── Stores ───────────────────────────────────────────────────────

export function useAdminStores() {
  const {
    items: stores,
    loading,
    error,
    reload,
    token,
  } = useAdminList<AdminStore>(() => '/admin/stores', pick<AdminStore>('stores'), '판매자 목록');

  const setCommission = async (storeId: string, rate: number): Promise<AdminCommandOutcome> => {
    return runAdminCommand(
      token,
      `/admin/stores/${storeId}/commission`,
      {
        method: 'PATCH',
        body: JSON.stringify({ rate }),
      },
      reload,
    );
  };

  // 치우기 — 기록 가드 차단(400) 사유를 UI에 그대로 안내해야 하므로
  // outcome boolean 축약 대신 ApiError를 직접 전파한다.
  // command 2xx 확인 뒤 reload 실패는 reconciliation으로 반환한다 (실패로 되돌리지 않음).
  const archiveStore = async (storeId: string): Promise<AdminReconciliation> => {
    if (!token) throw new Error('인증 토큰이 없습니다. 다시 로그인해 주세요.');
    await apiJson(`/admin/stores/${storeId}/archive`, token, { method: 'PATCH' });
    const readError = await reload();
    if (readError === null) return { reconciled: true, readError: null };
    return { reconciled: false, readError };
  };

  const restoreStore = async (storeId: string): Promise<AdminReconciliation> => {
    if (!token) throw new Error('인증 토큰이 없습니다. 다시 로그인해 주세요.');
    await apiJson(`/admin/stores/${storeId}/restore`, token, { method: 'PATCH' });
    const readError = await reload();
    if (readError === null) return { reconciled: true, readError: null };
    return { reconciled: false, readError };
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

  const toggleSuspend = async (
    userId: string,
    suspended: boolean,
  ): Promise<AdminCommandOutcome> => {
    return runAdminCommand(
      token,
      `/admin/users/${userId}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ suspended }),
      },
      reload,
    );
  };

  return { users, loading, error, reload, toggleSuspend };
}

// ── Orders ───────────────────────────────────────────────────────

export function useAdminOrders(filters?: { storeId?: string; status?: string }) {
  const {
    items: orders,
    loading,
    error,
    reload,
    token,
  } = useAdminList<AdminOrder>(
    () => withQuery('/admin/orders', { storeId: filters?.storeId, status: filters?.status }),
    pick<AdminOrder>('orders'),
    '주문 목록',
    [filters?.storeId, filters?.status],
  );

  const forceRefund = async (orderId: string, reason?: string): Promise<AdminCommandOutcome> => {
    return runAdminCommand(
      token,
      `/admin/orders/${orderId}/refund`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      },
      reload,
    );
  };

  return { orders, loading, error, reload, forceRefund };
}

// ── Settlements ──────────────────────────────────────────────────

export function useAdminSettlements(filters?: { storeId?: string; from?: string; to?: string }) {
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
      }),
    pick<AdminSettlement>('settlements'),
    '정산 목록',
    [filters?.storeId, filters?.from, filters?.to],
  );

  const markAsPaid = async (settlementId: string): Promise<AdminCommandOutcome> => {
    return runAdminCommand(token, `/admin/settlements/${settlementId}/pay`, { method: 'PATCH' }, reload);
  };

  return { settlements, loading, error, reload, markAsPaid };
}

// ── Drivers ──────────────────────────────────────────────────────

export function useAdminDrivers() {
  const {
    items: drivers,
    loading,
    error,
    reload,
    token,
  } = useAdminList<AdminDriver>(
    () => '/admin/drivers',
    pick<AdminDriver>('drivers'),
    '드라이버 목록',
  );

  const approve = async (userId: string): Promise<AdminCommandOutcome> => {
    return runAdminCommand(token, `/admin/drivers/${userId}/approve`, { method: 'PATCH' }, reload);
  };

  const toggleSuspend = async (
    userId: string,
    suspended: boolean,
  ): Promise<AdminCommandOutcome> => {
    return runAdminCommand(
      token,
      `/admin/drivers/${userId}/suspend`,
      {
        method: 'PATCH',
        body: JSON.stringify({ suspended }),
      },
      reload,
    );
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
  // Read failure는 genuine unset과 구분된다.
  // 백엔드 계약(AdminService.getBanner): 미설정 문서는 200 + null 반환,
  // 조회 실패만 non-2xx throw → error가 null이 아닌 경우만 FETCH_ERROR다.
  // 404 의미를 새로 정의하지 않는다 — null + error null이 unset의 전부다.
  const [error, setError] = useState<string | null>(null);
  // Save confirmed failure — "저장 완료" 상태로 붕괴하지 않도록 호출자에 노출한다.
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setBanner(await apiJson<AdminBanner | null>('/admin/banner', token));
    } catch {
      // 이전 성공 banner를 null로 덮어쓰지 않는다 — error 존재 자체가 실패의 증거다.
      setError('배너 조회 중 오류 발생');
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
    setSaveError(null);
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
      setSaveError('배너 저장 중 오류 발생');
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { banner, loading, saving, error, saveError, save, reload: load };
}

// ── Invite ───────────────────────────────────────────────────────

export function useAdminInvite() {
  const {
    items: invites,
    loading,
    error,
    reload,
    token,
  } = useAdminList<InviteToken>(
    () => '/admin/invite',
    (data) => (Array.isArray(data) ? (data as InviteToken[]) : []),
    '초대 토큰',
  );
  const [generating, setGenerating] = useState(false);
  // 발급 command 실패 — silent null로 끝내지 않고 UI에 노출한다.
  // 성공 시에만 null을 유지하고, 실패가 이전 성공 token을 덮어쓰지 않는 것은
  // 호출자(_client)가 result null 가드로 lastToken 갱신을 제한해 보장한다.
  const [generateError, setGenerateError] = useState<string | null>(null);

  const generate = async (): Promise<{ token: string; expiresAt: string } | null> => {
    if (!token) return null;
    setGenerating(true);
    setGenerateError(null);
    try {
      const data = await apiJson<{ token: string; expiresAt: string }>('/admin/invite', token, {
        method: 'POST',
      });
      await reload();
      return data;
    } catch {
      setGenerateError('초대 토큰 발급 중 오류 발생');
      return null;
    } finally {
      setGenerating(false);
    }
  };

  return { invites, loading, error, generating, generateError, generate, reload };
}
