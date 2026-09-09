'use client';

import { useState } from 'react';
import { useOrderStatusUpdate } from '@/hooks/useOrderStatusUpdate';
import { shouldReconcileOrderDetailAfterMutation } from './useOrderDetail.recovery';

export { shouldReconcileOrderDetailAfterMutation } from './useOrderDetail.recovery';

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
  handleShipParcel: () => Promise<void>;
}

/**
 * 주문 상세 페이지용 액션 — 프리셋 준비 폼 + 모달 취소 사유.
 * 상태 변경(PATCH)만 담당하며 detail GET의 owner가 되지 않는다.
 * mutation 성공 후에는 `onReconciled`가 가리키는
 * `useOrderDetail`의 authoritative refresh/reconcile 하나만 호출한다.
 * 재조회(GET) 실패를 command 실패(`actionError`)로 기록하지 않는다 —
 * GET 실패는 detail hook의 stale indication이 소유한다.
 */
export function useOrderDetailActions(
  storeId: string | null,
  orderId: string,
  onReconciled?: () => void,
): UseOrderDetailActionsResult {
  const { actionLoading, actionError, setActionError, updateStatus } = useOrderStatusUpdate(
    storeId,
    orderId,
  );
  const [showPrepareForm, setShowPrepareForm] = useState(false);
  const [preparedAt, setPreparedAt] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  function reconcileAfterCommand(commandOk: boolean) {
    if (shouldReconcileOrderDetailAfterMutation(commandOk)) onReconciled?.();
  }

  async function handlePrepare() {
    const ok = await updateStatus('PREPARING', preparedAt ? { preparedAt } : undefined);
    if (ok) {
      setShowPrepareForm(false);
      setPreparedAt(null);
    }
    reconcileAfterCommand(ok);
  }

  async function handleCancel() {
    if (cancelReason.trim().length < 5) return;
    const ok = await updateStatus('CANCELLED', { reason: cancelReason.trim() });
    if (ok) {
      setShowCancelModal(false);
      setCancelReason('');
    }
    reconcileAfterCommand(ok);
  }

  // BUG-16 T3: 택배 발송 완료 — PREPARING → DELIVERED 직행 (백엔드가 parcel 가드).
  async function handleShipParcel() {
    const ok = await updateStatus('DELIVERED');
    reconcileAfterCommand(ok);
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
    handleShipParcel,
  };
}
