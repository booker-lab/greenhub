'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import type { Order } from '@greenhub/shared'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface UseOrdersResult {
  orders: Order[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useOrders(): UseOrdersResult {
  const { data: session } = useSession()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const userId = session?.user?.id
    const token = session?.user?.accessToken
    if (!userId || !token) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    async function fetchOrders() {
      try {
        const url = `${API_URL}/orders?userId=${userId}`
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (cancelled) return
        if (!res.ok) throw new Error(`주문 조회 오류: ${res.status}`)

        const data = (await res.json()) as Order[]
        setOrders(data)
        setLoading(false)
        setError(null)
      } catch (e: unknown) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '오류가 발생했습니다.')
        setLoading(false)
      }
    }

    fetchOrders()
    return () => {
      cancelled = true
    }
  }, [session?.user?.id, session?.user?.accessToken, tick])

  return { orders, loading, error, refetch: () => setTick((t) => t + 1) }
}
