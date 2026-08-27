'use client';

import type { GroupProductConfig, Order } from '@greenhub/shared';
import { doc, getDoc } from 'firebase/firestore';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useFirebaseReady } from '@/app/providers';
import { apiJson } from '@/lib/api';
import { db } from '@/lib/firebase';

export interface UseOrderDetailResult {
  order: Order | null;
  productName: string | null;
  groupConfig: GroupProductConfig | null;
  loading: boolean;
}

export function useOrderDetail(orderId: string): UseOrderDetailResult {
  const { data: session, status: sessionStatus } = useSession();
  const firebaseReady = useFirebaseReady();
  const [order, setOrder] = useState<Order | null>(null);
  const [productName, setProductName] = useState<string | null>(null);
  const [groupConfig, setGroupConfig] = useState<GroupProductConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId || sessionStatus === 'loading') return;

    const storeId = session?.user.storeId;
    const token = session?.user.accessToken;
    if (!storeId || !token) {
      setOrder(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    apiJson<Order>(
      `/stores/${encodeURIComponent(storeId)}/orders/${encodeURIComponent(orderId)}`,
      token,
    )
      .then((payload) => {
        if (active) setOrder(payload);
      })
      .catch(() => {
        if (active) setOrder(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [orderId, session?.user.accessToken, session?.user.storeId, sessionStatus]);

  useEffect(() => {
    if (!order || !firebaseReady) return;
    if (order.productName) {
      setProductName(order.productName);
      return;
    }
    const snapshotProductName = order.orderItems?.[0]?.productName;
    if (snapshotProductName) {
      setProductName(snapshotProductName);
      return;
    }
    getDoc(doc(db, 'products', order.productId)).then((snap) => {
      if (snap.exists()) setProductName((snap.data() as { name: string }).name ?? null);
    });
  }, [order, firebaseReady]);

  useEffect(() => {
    if (!order || !firebaseReady || order.saleType !== 'group') return;
    const ref = doc(db, 'groupProductConfig', order.productId);
    getDoc(ref).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.recruitDeadline?.toDate)
          data.recruitDeadline = data.recruitDeadline.toDate().toISOString();
        if (data.groupDeliveryDate?.toDate)
          data.groupDeliveryDate = data.groupDeliveryDate.toDate().toISOString();
        setGroupConfig(data as GroupProductConfig);
      }
    });
  }, [order, firebaseReady]);

  return { order, productName, groupConfig, loading };
}
