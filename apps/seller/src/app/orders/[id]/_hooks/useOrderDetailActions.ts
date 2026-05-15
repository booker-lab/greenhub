'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { apiFetch } from '@/lib/api';

export interface UseOrderDetailActionsResult {
  actionLoading: boolean;
  actionError: string | null;
  setActionError: (e: string | null) => void;
  showPrepareForm: boolean;
  setShowPrepareForm: (v: boolean) => void;
  preparedAt: string | null;
  setPreparedAt: (v: string | null) => void;
  showCancelModal: boolean;
  setShowCancelModal: (v: boolean) => void;
  cancelReason: string;
  setCancelReason: (v: string) => void;
  handlePrepare: () => Promise<void>;
  handleCancel: () => Promise<void>;
}

export function useOrderDetailActions(
  storeId: string | null,
  orderId: string,
): UseOrderDetailActionsResult {
  const { data: session } = useSession();
  const token = session?.user.accessToken ?? '';

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPrepareForm, setShowPrepareForm] = useState(false);
  const [preparedAt, setPreparedAt] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  async function handlePrepare() {
    if (!storeId) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const body: Record<string, string> = { status: 'PREPARING' };
      if (preparedAt) body.preparedAt = preparedAt;
      const res = await apiFetch(`/stores/${storeId}/orders/${orderId}/status`, token, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      setShowPrepareForm(false);
      setPreparedAt(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '오류가 발생했습니다');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancel() {
    if (!storeId) return;
    if (cancelReason.trim().length < 5) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await apiFetch(`/stores/${storeId}/orders/${orderId}/status`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'CANCELLED', reason: cancelReason.trim() }),
      });
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      setShowCancelModal(false);
      setCancelReason('');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '오류가 발생했습니다');
    } finally {
      setActionLoading(false);
    }
  }

  return {
    actionLoading,
    actionError,
    setActionError,
    showPrepareForm,
    setShowPrepareForm,
    preparedAt,
    setPreparedAt,
    showCancelModal,
    setShowCancelModal,
    cancelReason,
    setCancelReason,
    handlePrepare,
    handleCancel,
  };
}
