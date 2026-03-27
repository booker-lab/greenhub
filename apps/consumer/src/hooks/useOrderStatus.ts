'use client'

import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Order } from '@greenhub/shared'

interface UseOrderStatusResult {
  order: Order | null
  loading: boolean
  error: string | null
}

export function useOrderStatus(orderId: string | null): UseOrderStatusResult {
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orderId) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function fetchOrder() {
      try {
        const snap = await getDoc(doc(db, 'orders', orderId!))
        if (cancelled) return
        if (snap.exists()) {
          setOrder({ id: snap.id, ...snap.data() } as Order)
        } else {
          setOrder(null)
        }
        setLoading(false)
        setError(null)
      } catch (e: unknown) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : '오류가 발생했습니다.'
        setError(msg)
        setLoading(false)
      }
    }

    fetchOrder()
    const interval = setInterval(fetchOrder, 3000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [orderId])

  return { order, loading, error }
}
