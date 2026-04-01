'use client'

import { useEffect, useState } from 'react'
import { collection, query, where, getDocs, doc, getDoc, QueryConstraint } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Product, Category } from '@greenhub/shared'

// MVP 고정 스토어
const STORE_ID = 'dear-orchid'

/**
 * Firestore `products` 컬렉션에서 활성 상품 목록 조회
 * @param category 카테고리 필터 (없으면 전체)
 */
export function useProducts(category?: Category) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    async function fetch() {
      try {
        const constraints: QueryConstraint[] = [
          where('storeId', '==', STORE_ID),
          where('isActive', '==', true),
        ]
        if (category) {
          constraints.push(where('category', '==', category))
        }
        const q = query(collection(db, 'products'), ...constraints)
        const snap = await getDocs(q)
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Product)
        setProducts(items)
        setError(null)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '상품 조회 실패')
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [category])

  return { products, loading, error }
}

/**
 * 단일 상품 조회
 */
export function useProduct(productId: string) {
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!productId) {
      setLoading(false)
      return
    }
    async function fetch() {
      try {
        const snap = await getDoc(doc(db, 'products', productId))
        if (snap.exists()) {
          setProduct({ id: snap.id, ...snap.data() } as Product)
        } else {
          setError('상품을 찾을 수 없습니다.')
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '상품 조회 실패')
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [productId])

  return { product, loading, error }
}
