'use client';

import type { OrderStatus } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useCallback, useState } from 'react';
import { apiJson } from '@/lib/api';

export interface OrderStatusExtra {
  reason?: string;
  preparedAt?: string;
}

/**
 * 주문 상태 변경 PATCH의 공통 코어.
 * 상세 페이지의 `useOrderDetailActions`가 이 훅을 사용한다 —
 * fetch·에러 처리는 여기 한 곳, 사유 입력 UI(모달)는 래퍼에서 담당.
 */
export function useOrderStatusUpdate(storeId: string | null, orderId: string) {
  const { data: session } = useSession();
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const updateStatus = useCallback(
    async (status: OrderStatus, extra?: OrderStatusExtra): Promise<boolean> => {
      if (!storeId) return false;
      setActionLoading(true);
      setActionError(null);
      try {
        await apiJson(
          `/stores/${storeId}/orders/${orderId}/status`,
          session?.user.accessToken ?? '',
          { method: 'PATCH', body: JSON.stringify({ status, ...extra }) },
        );
        return true;
      } catch (e) {
        setActionError(e instanceof Error ? e.message : '오류가 발생했습니다');
        return false;
      } finally {
        setActionLoading(false);
      }
    },
    [storeId, orderId, session?.user.accessToken],
  );

  return { actionLoading, actionError, setActionError, updateStatus };
}
