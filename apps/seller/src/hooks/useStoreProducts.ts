'use client'

import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
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
    )

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs
          .map((d) => {
            const data = d.data()
            if (data['createdAt']?.toDate) data['createdAt'] = data['createdAt'].toDate().toISOString()
            if (data['updatedAt']?.toDate) data['updatedAt'] = data['updatedAt'].toDate().toISOString()
            return { id: d.id, ...data } as Product
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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
