'use client'

import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
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

    const ref = doc(db, 'orders', orderId)
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setOrder({ id: snap.id, ...snap.data() } as Order)
        } else {
          setOrder(null)
        }
        setLoading(false)
        setError(null)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      },
    )

    return unsubscribe
  }, [orderId])

  return { order, loading, error }
}
