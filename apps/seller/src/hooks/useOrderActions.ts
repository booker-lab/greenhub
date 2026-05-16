'use client';

import { useState } from 'react';
import type { OrderStatus } from '@greenhub/shared';
import { useOrderStatusUpdate, type OrderStatusExtra } from './useOrderStatusUpdate';

/** OrderCard(목록)용 주문 액션 — 인라인 준비 폼 + prompt() 취소 사유. */
export function useOrderActions(storeId: string | null, orderId: string) {
  const { actionLoading, actionError, setActionError, updateStatus } = useOrderStatusUpdate(
    storeId,
    orderId,
  );
  const [showPrepareForm, setShowPrepareForm] = useState(false);
  const [preparedAtInput, setPreparedAtInput] = useState('');

  async function handleStatusChange(status: OrderStatus, extra?: OrderStatusExtra) {
    await updateStatus(status, extra);
  }

  async function handlePrepare() {
    const extra = preparedAtInput
      ? { preparedAt: new Date(preparedAtInput).toISOString() }
      : undefined;
    await updateStatus('PREPARING', extra);
    setShowPrepareForm(false);
    setPreparedAtInput('');
  }

  async function handleCancel() {
    const reason = prompt('취소 사유를 입력하세요 (최소 5자)');
    if (!reason || reason.trim().length < 5) {
      if (reason !== null) alert('취소 사유는 최소 5자 이상 입력해주세요.');
      return;
    }
    await updateStatus('CANCELLED', { reason: reason.trim() });
  }

  return {
    actionLoading,
    actionError,
    setActionError,
    showPrepareForm,
    setShowPrepareForm,
    preparedAtInput,
    setPreparedAtInput,
    handleStatusChange,
    handlePrepare,
    handleCancel,
  };
}
