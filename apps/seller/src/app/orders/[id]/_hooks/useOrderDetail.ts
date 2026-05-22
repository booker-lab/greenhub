'use client';

import type { GroupProductConfig, Order } from '@greenhub/shared';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { useFirebaseReady } from '@/app/providers';
import { db } from '@/lib/firebase';

export interface UseOrderDetailResult {
  order: Order | null;
  productName: string | null;
  groupConfig: GroupProductConfig | null;
  loading: boolean;
}

export function useOrderDetail(orderId: string): UseOrderDetailResult {
  const firebaseReady = useFirebaseReady();
  const [order, setOrder] = useState<Order | null>(null);
  const [productName, setProductName] = useState<string | null>(null);
  const [groupConfig, setGroupConfig] = useState<GroupProductConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId || !firebaseReady) return;
    const ref = doc(db, 'orders', orderId);
    const unsubscribe = onSnapshot(ref, (snap) => {
      if (snap.exists()) setOrder({ id: snap.id, ...snap.data() } as Order);
      setLoading(false);
    });
    return unsubscribe;
  }, [orderId, firebaseReady]);

  useEffect(() => {
    if (!order) return;
    if (order.productName) {
      setProductName(order.productName);
      return;
    }
    getDoc(doc(db, 'products', order.productId)).then((snap) => {
      if (snap.exists()) setProductName((snap.data() as { name: string }).name ?? null);
    });
  }, [order]);

  useEffect(() => {
    if (!order || order.saleType !== 'group') return;
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
  }, [order]);

  return { order, productName, groupConfig, loading };
}
