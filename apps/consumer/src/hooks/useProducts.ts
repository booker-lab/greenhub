'use client'

import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Product, Category, ColorOption } from '@greenhub/shared'

export interface StoreInfo {
  id: string
  name: string
  ceoName: string
  phone: string
  address: string
  logoUrl: string | null
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

/**
 * API를 통해 활성 상품 목록 조회
 * @param category 카테고리 필터 (없으면 전체)
 */
export function useProducts(category?: Category, colors?: ColorOption[]) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const colorKey = colors?.join(',') ?? ''

  useEffect(() => {
    setLoading(true)
    setProducts([])
    async function fetchProducts() {
      try {
        const params = new URLSearchParams({ isActive: 'true' })
        if (category) params.set('category', category)
        if (colors && colors.length > 0) {
          colors.forEach((c) => params.append('colors[]', c))
        }
        const res = await fetch(`${API_URL}/products?${params}`)
        if (!res.ok) throw new Error(`서버 오류 ${res.status}`)
        const data = await res.json()
        const items: Product[] = Array.isArray(data) ? data : (data.items ?? [])
        items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
        setProducts(items)
        setError(null)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '상품 조회 실패')
      } finally {
        setLoading(false)
      }
    }
    fetchProducts()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, colorKey])

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
    async function fetchProduct() {
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
    fetchProduct()
  }, [productId])

  return { product, loading, error }
}

/**
 * 단일 스토어 정보 조회
 */
export function useStore(storeId: string | null) {
  const [store, setStore] = useState<StoreInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!storeId) {
      setLoading(false)
      return
    }
    const sid = storeId
    async function fetchStore() {
      try {
        const snap = await getDoc(doc(db, 'stores', sid))
        if (snap.exists()) {
          setStore({ id: snap.id, ...snap.data() } as StoreInfo)
        }
      } finally {
        setLoading(false)
      }
    }
    fetchStore()
  }, [storeId])

  return { store, loading }
}
