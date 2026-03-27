'use client'

import { useEffect, useState } from 'react'
import type { Order } from '@greenhub/shared'

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { mapValue: { fields?: Record<string, FirestoreValue> } }
  | { arrayValue: { values?: FirestoreValue[] } }

function parseValue(val: FirestoreValue): unknown {
  if ('stringValue' in val) return val.stringValue
  if ('integerValue' in val) return Number(val.integerValue)
  if ('doubleValue' in val) return val.doubleValue
  if ('booleanValue' in val) return val.booleanValue
  if ('nullValue' in val) return null
  if ('timestampValue' in val) return val.timestampValue
  if ('mapValue' in val) {
    const fields = val.mapValue.fields ?? {}
    return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, parseValue(v)]))
  }
  if ('arrayValue' in val) {
    return (val.arrayValue.values ?? []).map(parseValue)
  }
  return null
}

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID

interface UseOrderStatusResult {
  order: Order | null
  loading: boolean
  error: string | null
}

// NOTE: Firebase SDK의 onSnapshot은 PWA Service Worker와 충돌하여 동작 불가.
// Firestore REST API 직접 호출(3초 폴링)로 대체. 결제 완료 화면은 실시간 불필요.
// 설계 결정: docs/CRITICAL_LOGIC.md [2026-03-27] 참조
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
        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/orders/${orderId}`
        const res = await fetch(url)
        if (cancelled) return

        if (res.status === 404) {
          setOrder(null)
          setLoading(false)
          return
        }
        if (!res.ok) throw new Error(`Firestore 응답 오류: ${res.status}`)

        const data = await res.json()
        const fields = data.fields as Record<string, FirestoreValue>
        const parsed = Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [k, parseValue(v)]),
        ) as Record<string, unknown>

        setOrder({ id: orderId, ...parsed } as Order)
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
  }, [orderId])

  return { order, loading, error }
}
