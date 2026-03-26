'use client'

import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { DailyCap } from '@greenhub/shared'

interface UseDailyCapResult {
  dailyCap: DailyCap | null
  loading: boolean
  error: string | null
  remainingSlots: number
}

/**
 * @param storeId  - 스토어 ID
 * @param date     - 'YYYY-MM-DD' 형식. 미전달 시 오늘 날짜 사용
 */
export function useDailyCap(storeId: string | null, date?: string): UseDailyCapResult {
  const [dailyCap, setDailyCap] = useState<DailyCap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const resolvedDate = date ?? new Date().toISOString().split('T')[0]
  const docId = storeId ? `${storeId}_${resolvedDate}` : null

  useEffect(() => {
    if (!docId) {
      setLoading(false)
      return
    }

    const ref = doc(db, 'dailyCaps', docId)
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setDailyCap(snap.data() as DailyCap)
        } else {
          setDailyCap(null)
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
  }, [docId])

  const remainingSlots = dailyCap ? dailyCap.totalCap - dailyCap.usedSlots : 0

  return { dailyCap, loading, error, remainingSlots }
}
