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
  expiresAt: string | null;
  createdAt: string | null;
}

export type InviteRevokeReason = 'already_used' | 'already_revoked' | 'expired' | 'unknown';

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
  const [generating, setGenerating] = useState(false);
  const searchQuery = query.trim().length >= 4 ? query.trim().toUpperCase() : undefined;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiJson<unknown>(withQuery('/admin/invite', { q: searchQuery }), token);
      setInvites(Array.isArray(data) ? (data as InviteToken[]) : []);
    } catch {
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async (): Promise<{ token: string; expiresAt: string } | null> => {
    if (!token) return null;
    setGenerating(true);
    try {
      const data = await apiJson<{ token: string; expiresAt: string }>('/admin/invite', token, {
        method: 'POST',
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

  return { invites, loading, generating, query, setQuery, generate, revoke, reload: load };
}
