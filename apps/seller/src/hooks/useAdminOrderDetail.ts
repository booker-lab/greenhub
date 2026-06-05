'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import type { AdminOrder } from '@/hooks/useAdmin';
import { apiJson } from '@/lib/api';

export interface AdminOrderDetailItem {
  productId: string | null;
  productName: string | null;
  quantity: number | null;
  totalAmount: number | null;
}

export interface AdminOrderDetailEntity {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  ownerId?: string | null;
  status?: string | null;
}

export interface AdminOrderPayment {
  id: string;
  amount?: number;
  payMethod?: string;
  status?: string;
  portoneTransactionId?: string;
  paidAt?: unknown;
  refundedAt?: unknown;
}

export interface AdminOrderTimelineEvent {
  label: string;
  status: string;
  at: unknown;
}

export interface AdminOrderDetail {
  order: AdminOrder;
  store: AdminOrderDetailEntity | null;
  buyer: AdminOrderDetailEntity | null;
  payment: AdminOrderPayment | null;
  items: AdminOrderDetailItem[];
  timeline: AdminOrderTimelineEvent[];
}

export function useAdminOrderDetail(orderId: string) {
  const { data: session } = useSession();
  const token = session?.user.accessToken;
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!token || !orderId) return;
    setLoading(true);
    try {
      const data = await apiJson<AdminOrderDetail>(`/admin/orders/${orderId}`, token);
      setDetail(data);
      setError(null);
    } catch (e) {
      setDetail(null);
      setError(e instanceof Error ? e.message : '주문 상세 조회 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [orderId, token]);

  const updateTracking = useCallback(
    async (payload: { courierCompany: string; trackingNumber: string }) => {
      if (!token || !orderId) throw new Error('인증 정보가 없습니다.');
      await apiJson(`/admin/orders/${orderId}/tracking`, token, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await reload();
    },
    [orderId, reload, token],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return { detail, loading, error, reload, updateTracking };
}
