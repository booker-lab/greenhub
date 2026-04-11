'use client'

import { useEffect, useState } from 'react'
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Product } from '@greenhub/shared'

interface UseStoreProductsResult {
  products: Product[]
  loading: boolean
  error: string | null
}

export function useStoreProducts(storeId: string | null): UseStoreProductsResult {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!storeId) {
      setLoading(false)
      return
    }

    const q = query(
      collection(db, 'products'),
      where('storeId', '==', storeId),
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Product)
        setProducts(items)
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

  return { products, loading, error }
}
