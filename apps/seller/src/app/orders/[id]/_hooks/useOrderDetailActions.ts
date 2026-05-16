'use client';

import { useState } from 'react';
import { useOrderStatusUpdate } from '@/hooks/useOrderStatusUpdate';

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

/** 주문 상세 페이지용 액션 — 프리셋 준비 폼 + 모달 취소 사유. */
export function useOrderDetailActions(
  storeId: string | null,
  orderId: string,
): UseOrderDetailActionsResult {
  const { actionLoading, actionError, setActionError, updateStatus } = useOrderStatusUpdate(
    storeId,
    orderId,
  );
  const [showPrepareForm, setShowPrepareForm] = useState(false);
  const [preparedAt, setPreparedAt] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  async function handlePrepare() {
    const ok = await updateStatus('PREPARING', preparedAt ? { preparedAt } : undefined);
    if (ok) {
      setShowPrepareForm(false);
      setPreparedAt(null);
    }
  }

  async function handleCancel() {
    if (cancelReason.trim().length < 5) return;
    const ok = await updateStatus('CANCELLED', { reason: cancelReason.trim() });
    if (ok) {
      setShowCancelModal(false);
      setCancelReason('');
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
