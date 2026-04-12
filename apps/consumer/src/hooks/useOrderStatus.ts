'use client'

import { useEffect, useState } from 'react'
import type { Order } from '@greenhub/shared'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
// NOTE: Firebase SDK의 onSnapshot은 PWA Service Worker와 충돌하여 동작 불가.
// Firestore REST API 대신 Railway API 폴링 방식으로 대체. 설계 결정: docs/CRITICAL_LOGIC.md [2026-03-27] 참조

interface UseOrderStatusResult {
  order: Order | null
  loading: boolean
  error: string | null
}

export function useOrderStatus(orderId: string | null, accessToken?: string): UseOrderStatusResult {
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // accessToken이 undefined면 세션 아직 로딩 중 — 대기
    if (!orderId || accessToken === undefined) return
    if (!orderId) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function fetchOrder() {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

        const res = await fetch(`${API}/orders/${orderId}`, { headers })
        if (cancelled) return

        if (res.status === 404) {
          setOrder(null)
          setLoading(false)
          return
        }
        if (!res.ok) throw new Error('주문 정보를 불러올 수 없습니다.')

        const data = await res.json()
        setOrder(data as Order)
        setLoading(false)
        setError(null)
      } catch (e: unknown) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '오류가 발생했습니다.')
        setLoading(false)
      }
    }

    fetchOrder()
    const interval = setInterval(fetchOrder, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [orderId, accessToken])

  return { order, loading, error }
}
