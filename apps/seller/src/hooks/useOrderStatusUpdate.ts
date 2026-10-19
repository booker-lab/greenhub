'use client';

import type { OrderStatus } from '@greenhub/shared';
import { useSession } from 'next-auth/react';
import { useCallback, useState } from 'react';
import type { DeliveryHoldPayload } from '@/app/orders/[id]/delivery-hold-form';
import { apiJson } from '@/lib/api';
import { apiPathSegment } from '@/lib/api-path';

export interface OrderStatusExtra {
  reason?: string;
  preparedAt?: string;
}

/**
 * 주문 하나의 상태 변경 PATCH 요청. 상세 화면 훅과 회차 "모두 준비 시작"이 같은 요청을 쓴다.
 * 실패하면 서버 메시지를 담은 `ApiError`를 던진다.
 * ID 형식이 맞지 않으면 요청 없이 `InvalidApiPathSegmentError`로 거절한다.
 */
export async function requestOrderStatusChange(
  storeId: string,
  orderId: string,
  token: string,
  status: OrderStatus,
  extra?: OrderStatusExtra,
): Promise<unknown> {
  return apiJson(
    `/stores/${apiPathSegment(storeId)}/orders/${apiPathSegment(orderId)}/status`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify({ status, ...extra }),
    },
  );
}

/** 배송 보류 기록 PATCH(`→ DELIVERY_HELD`). 기사 앱과 같은 보류 엔드포인트를 쓴다. */
export async function requestDeliveryHold(
  storeId: string,
  orderId: string,
  token: string,
  deliveryHold: DeliveryHoldPayload,
): Promise<unknown> {
  return apiJson(
    `/stores/${apiPathSegment(storeId)}/orders/${apiPathSegment(orderId)}/delivery-hold`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify({ deliveryHold }),
    },
  );
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
  const token = session?.user.accessToken ?? '';

  const runCommand = useCallback(
    async (request: (storeId: string, token: string) => Promise<unknown>): Promise<boolean> => {
      if (!storeId) return false;
      setActionLoading(true);
      setActionError(null);
      try {
        await request(storeId, token);
        return true;
      } catch (e) {
        setActionError(e instanceof Error ? e.message : '오류가 발생했습니다');
        return false;
      } finally {
        setActionLoading(false);
      }
    },
    [storeId, token],
  );

  const updateStatus = useCallback(
    (status: OrderStatus, extra?: OrderStatusExtra): Promise<boolean> =>
      runCommand((sid, t) => requestOrderStatusChange(sid, orderId, t, status, extra)),
    [runCommand, orderId],
  );

  const holdDelivery = useCallback(
    (deliveryHold: DeliveryHoldPayload): Promise<boolean> =>
      runCommand((sid, t) => requestDeliveryHold(sid, orderId, t, deliveryHold)),
    [runCommand, orderId],
  );

  return { actionLoading, actionError, setActionError, updateStatus, holdDelivery };
}
