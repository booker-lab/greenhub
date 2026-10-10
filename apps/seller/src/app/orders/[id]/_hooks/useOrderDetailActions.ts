'use client';

import { useState } from 'react';
import { useOrderStatusUpdate } from '@/hooks/useOrderStatusUpdate';
import type { DeliveryHoldPayload } from '../delivery-hold-form';
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
  showHoldModal: boolean;
  setShowHoldModal: (v: boolean) => void;
  showReleaseConfirm: boolean;
  setShowReleaseConfirm: (v: boolean) => void;
  handlePrepare: () => Promise<void>;
  handleCancel: () => Promise<void>;
  handleShipParcel: () => Promise<void>;
  handleHold: (deliveryHold: DeliveryHoldPayload) => Promise<boolean>;
  handleReleaseHold: () => Promise<void>;
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
  const { actionLoading, actionError, setActionError, updateStatus, holdDelivery } =
    useOrderStatusUpdate(storeId, orderId);
  const [showPrepareForm, setShowPrepareForm] = useState(false);
  const [preparedAt, setPreparedAt] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);

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

  // 기사가 가져가기 전 판매자 보류(PREPARING → DELIVERY_HELD). 실패하면 창을 열어 둔 채 오류를 보인다.
  async function handleHold(deliveryHold: DeliveryHoldPayload) {
    const ok = await holdDelivery(deliveryHold);
    if (ok) setShowHoldModal(false);
    reconcileAfterCommand(ok);
    return ok;
  }

  // 보류 해소 — 재배송 준비(DELIVERY_HELD → PREPARING). 알림톡 여부는 서버가 보류 내용으로 정한다.
  async function handleReleaseHold() {
    const ok = await updateStatus('PREPARING');
    setShowReleaseConfirm(false);
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
    showHoldModal,
    setShowHoldModal,
    showReleaseConfirm,
    setShowReleaseConfirm,
    handlePrepare,
    handleCancel,
    handleShipParcel,
    handleHold,
    handleReleaseHold,
  };
}
