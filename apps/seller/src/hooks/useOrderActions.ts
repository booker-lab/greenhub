'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import type { OrderStatus } from '@greenhub/shared';

export function useOrderActions(storeId: string | null, orderId: string) {
  const { data: session } = useSession();
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPrepareForm, setShowPrepareForm] = useState(false);
  const [preparedAtInput, setPreparedAtInput] = useState('');

  async function handleStatusChange(
    status: OrderStatus,
    extra?: { reason?: string; preparedAt?: string },
  ) {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/stores/${storeId}/orders/${orderId}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.user.accessToken}`,
          },
          body: JSON.stringify({ status, ...extra }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(`오류 ${res.status}: ${body?.message ?? '상태 변경 실패'}`);
      }
    } catch {
      setActionError('네트워크 오류가 발생했습니다');
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePrepare() {
    const extra = preparedAtInput
      ? { preparedAt: new Date(preparedAtInput).toISOString() }
      : undefined;
    await handleStatusChange('PREPARING', extra);
    setShowPrepareForm(false);
    setPreparedAtInput('');
  }

  async function handleCancel() {
    const reason = prompt('취소 사유를 입력하세요 (최소 5자)');
    if (!reason || reason.trim().length < 5) {
      if (reason !== null) alert('취소 사유는 최소 5자 이상 입력해주세요.');
      return;
    }
    await handleStatusChange('CANCELLED', { reason: reason.trim() });
  }

  return {
    actionLoading,
    actionError,
    showPrepareForm,
    setShowPrepareForm,
    preparedAtInput,
    setPreparedAtInput,
    handleStatusChange,
    handlePrepare,
    handleCancel,
  };
}
