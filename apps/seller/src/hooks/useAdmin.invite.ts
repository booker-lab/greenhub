'use client';

import { useState } from 'react';
import { apiFetch, apiJson } from '@/lib/api';
import {
  classifyAdminCommandError,
  missingTokenOutcome,
  resolveConfirmedOutcome,
} from './useAdmin.outcome';
import { readCappedList } from './useAdmin.listCap';
import { useAdminList } from './useAdmin.list';
import type { InviteRevokeOutcome, InviteToken, IssuedInvite } from './useAdmin.types';

// ── Invite ───────────────────────────────────────────────────────

export function useAdminInvite() {
  // 서버 상한(최근 N건)에 닿았으면 그 건수. 조회 경로가 하나뿐이라 겹친 응답도 같은 목록이다.
  const [cap, setCap] = useState<number | null>(null);
  const {
    items: invites,
    loading,
    error,
    reload,
    token,
  } = useAdminList<InviteToken>(
    () => '/admin/invite',
    (data) => {
      const list = readCappedList<InviteToken>(data, 'invites');
      setCap(list.cap);
      return list.items;
    },
    '초대 토큰',
  );
  const [generating, setGenerating] = useState(false);
  // 발급 command 실패 — silent null로 끝내지 않고 UI에 노출한다.
  // 성공 시에만 null을 유지하고, 실패가 이전 성공 token을 덮어쓰지 않는 것은
  // 호출자(_client)가 result null 가드로 lastToken 갱신을 제한해 보장한다.
  const [generateError, setGenerateError] = useState<string | null>(null);

  // 받는 사람 이메일(필수)로만 가입할 수 있는 초대를 발급한다. 본문에는 항상 recipientEmail을 담는다.
  const generate = async (recipientEmail: string): Promise<IssuedInvite | null> => {
    if (!token) return null;
    setGenerating(true);
    setGenerateError(null);
    try {
      const data = await apiJson<IssuedInvite>('/admin/invite', token, {
        method: 'POST',
        body: JSON.stringify({ recipientEmail }),
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

  // 취소 — 409 reason을 보존해야 하므로 apiJson 대신 apiFetch로 본문을 직접 읽는다.
  // 4xx는 rejected(+reason), 5xx·transport는 unknown, 2xx는 목록 reload 결과로 reconciliation한다.
  const revoke = async (inviteToken: string): Promise<InviteRevokeOutcome> => {
    if (!token) return { ...missingTokenOutcome(), reason: null };
    let res: Response;
    try {
      res = await apiFetch(`/admin/invite/${encodeURIComponent(inviteToken)}/revoke`, token, {
        method: 'POST',
      });
    } catch (err) {
      const outcome = classifyAdminCommandError(err);
      return outcome.kind === 'unknown' ? outcome : { ...outcome, reason: null };
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: unknown; reason?: unknown };
      const message =
        typeof body?.message === 'string' ? body.message : `서버 오류 (${res.status})`;
      const outcome = classifyAdminCommandError({ status: res.status, message });
      if (outcome.kind === 'unknown') return outcome;
      return { ...outcome, reason: typeof body?.reason === 'string' ? body.reason : null };
    }
    return resolveConfirmedOutcome(await reload());
  };

  return { invites, cap, loading, error, generating, generateError, generate, revoke, reload };
}
