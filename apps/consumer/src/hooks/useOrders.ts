'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import type { Order } from '@greenhub/shared'
import { parseFirestoreDoc, type FirestoreValue } from '@/lib/firestore'

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID

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
    if (!userId) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    async function fetchOrders() {
      try {
        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: 'orders' }],
              where: {
                fieldFilter: {
                  field: { fieldPath: 'userId' },
                  op: 'EQUAL',
                  value: { stringValue: userId },
                },
              },
              orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
            },
          }),
        })
        if (cancelled) return
        if (!res.ok) throw new Error(`Firestore 응답 오류: ${res.status}`)

        const docs = (await res.json()) as Array<{
          document?: { name: string; fields: Record<string, FirestoreValue> }
        }>

        const parsed = docs
          .filter((d) => d.document)
          .map((d) => parseFirestoreDoc<Order>(d.document!))

        setOrders(parsed)
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
  }, [session?.user?.id, tick])

  return { orders, loading, error, refetch: () => setTick((t) => t + 1) }
}
