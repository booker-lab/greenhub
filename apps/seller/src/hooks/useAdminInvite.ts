'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiJson } from '@/lib/api';

export interface InviteToken {
  token: string;
  createdBy: string;
  usedAt: string | null;
  usedBy: string | null;
  revokedAt?: string | null;
  revokedBy?: string | null;
  sellerRollbackAt?: string | null;
  sellerRollbackBy?: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}

export type InviteRevokeReason = 'already_used' | 'already_revoked' | 'expired' | 'unknown';
export type InviteRollbackReason =
  | 'not_used'
  | 'already_rolled_back'
  | 'user_not_found'
  | 'not_seller'
  | 'store_not_found'
  | 'store_has_records'
  | 'unknown';

interface AdminInvitesResponse {
  invites?: InviteToken[];
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

export function useAdminInvite() {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [invites, setInvites] = useState<InviteToken[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const searchQuery = query.trim().length >= 4 ? query.trim().toUpperCase() : undefined;

  const load = useCallback(
    async (cursor?: string | null) => {
      if (!token) return;
      const append = Boolean(cursor);
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const data = await apiJson<unknown>(
          withQuery('/admin/invite', { q: searchQuery, cursor: cursor ?? undefined }),
          token,
        );
        const response = Array.isArray(data)
          ? { invites: data as InviteToken[], nextCursor: null }
          : (data as AdminInvitesResponse);
        setInvites((current) =>
          append ? [...current, ...(response.invites ?? [])] : (response.invites ?? []),
        );
        setNextCursor(response.nextCursor ?? null);
      } catch {
        if (!append) {
          setInvites([]);
          setNextCursor(null);
        }
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [searchQuery, token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async (
    expiresInDays = 7,
  ): Promise<{ token: string; expiresAt: string } | null> => {
    if (!token) return null;
    setGenerating(true);
    try {
      const data = await apiJson<{ token: string; expiresAt: string }>('/admin/invite', token, {
        method: 'POST',
        body: JSON.stringify({ expiresInDays }),
      });
      await load();
      return data;
    } catch {
      return null;
    } finally {
      setGenerating(false);
    }
  };

  const revoke = async (
    inviteToken: string,
  ): Promise<{ ok: true } | { ok: false; reason: InviteRevokeReason }> => {
    if (!token) return { ok: false, reason: 'unknown' };
    try {
      await apiJson(`/admin/invite/${inviteToken}/revoke`, token, { method: 'POST' });
      await load();
      return { ok: true };
    } catch (error) {
      const reason = error instanceof ApiError ? error.reason : undefined;
      if (reason === 'already_used' || reason === 'already_revoked' || reason === 'expired') {
        return { ok: false, reason };
      }
      return { ok: false, reason: 'unknown' };
    }
  };

  const rollbackSeller = async (
    inviteToken: string,
  ): Promise<{ ok: true } | { ok: false; reason: InviteRollbackReason }> => {
    if (!token) return { ok: false, reason: 'unknown' };
    try {
      await apiJson(`/admin/invite/${inviteToken}/rollback-seller`, token, { method: 'POST' });
      await load();
      return { ok: true };
    } catch (error) {
      const reason = error instanceof ApiError ? error.reason : undefined;
      if (
        reason === 'not_used' ||
        reason === 'already_rolled_back' ||
        reason === 'user_not_found' ||
        reason === 'not_seller' ||
        reason === 'store_not_found' ||
        reason === 'store_has_records'
      ) {
        return { ok: false, reason };
      }
      return { ok: false, reason: 'unknown' };
    }
  };

  return {
    invites,
    loading,
    loadingMore,
    generating,
    query,
    setQuery,
    hasMore: Boolean(nextCursor),
    generate,
    revoke,
    rollbackSeller,
    reload: () => load(),
    loadMore: () => load(nextCursor),
  };
}
