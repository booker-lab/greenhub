'use client'

import { useEffect, useMemo, useState } from 'react'
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Order, OrderStatus } from '@greenhub/shared'

export const TAB_STATUSES: Record<string, OrderStatus[]> = {
  pending: ['PENDING', 'RECRUITING', 'ACCEPTED', 'CONFIRMED'],
  preparing: ['PREPARING'],
  delivering: ['DELIVERING', 'HUB_ARRIVED'],
  done: ['DELIVERED', 'PICKED_UP', 'REVIEWED'],
  cancelled: ['CANCELLED'],
}

interface UseOrdersResult {
  orders: Order[]
  loading: boolean
  error: string | null
  counts: Record<string, number>
}

/**
 * storeId의 전체 주문을 실시간 구독.
 * 탭 필터링은 클라이언트에서 수행 (Firestore 복합 인덱스 절약).
 */
export function useOrders(storeId: string | null): UseOrdersResult {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!storeId) {
      setLoading(false)
      return
    }

    const q = query(
      collection(db, 'orders'),
      where('storeId', '==', storeId),
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order)
        setOrders(items)
        setLoading(false)
        setError(null)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      },
    )

    return unsubscribe
  }, [storeId])

  const counts = useMemo(() => {
    const result: Record<string, number> = {}
    for (const [tab, statuses] of Object.entries(TAB_STATUSES)) {
      result[tab] = orders.filter((o) => statuses.includes(o.status)).length
    }
    return result
  }, [orders])

  return { orders, loading, error, counts }
}
