'use client'

import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { GroupProductConfig } from '@greenhub/shared'

interface UseGroupProductResult {
  config: GroupProductConfig | null
  loading: boolean
  error: string | null
}

export function useGroupProduct(productId: string | null): UseGroupProductResult {
  const [config, setConfig] = useState<GroupProductConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!productId) {
      setLoading(false)
      return
    }

    const ref = doc(db, 'groupProductConfig', productId)
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setConfig(snap.data() as GroupProductConfig)
        } else {
          setConfig(null)
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
  }, [productId])

  return { config, loading, error }
}
