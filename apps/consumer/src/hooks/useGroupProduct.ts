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
          const data = snap.data()
          // Firestore Timestamp → ISO string 변환
          if (data['recruitDeadline']?.toDate) data['recruitDeadline'] = data['recruitDeadline'].toDate().toISOString()
          if (data['groupDeliveryDate']?.toDate) data['groupDeliveryDate'] = data['groupDeliveryDate'].toDate().toISOString()
          setConfig(data as GroupProductConfig)
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
