'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { useStoreProducts } from '@/hooks/useStoreProducts'
import type { Product } from '@greenhub/shared'

type ProductFilter = 'all' | 'active' | 'inactive'

const CATEGORY_LABEL: Record<string, string> = {
  cut_flower: '절화',
  orchid: '난',
  foliage: '관엽',
}

export default function ProductsPage() {
  const { data: session } = useSession()
  const storeId = session?.user.storeId ?? null
  const { products, loading } = useStoreProducts(storeId)
  const [filter, setFilter] = useState<ProductFilter>('all')

  const filtered = products.filter((p) => {
    if (filter === 'active') return p.isActive
    if (filter === 'inactive') return !p.isActive
    return true
  })

  return (
    <main className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">상품 관리</h1>
          <Link
            href="/products/new"
            className="flex items-center gap-1 bg-green-primary text-white text-sm font-medium px-3 py-1.5 rounded-lg"
          >
            + 등록
          </Link>
        </div>
      </header>

      {/* 필터 탭 */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-lg mx-auto flex">
          {(['all', 'active', 'inactive'] as ProductFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                filter === f
                  ? 'border-green-primary text-green-primary'
                  : 'border-transparent text-gray-500'
              }`}
            >
              {f === 'all' ? `전체 ${products.length}` : f === 'active' ? '판매 중' : '비활성'}
            </button>
          ))}
        </div>
      </div>

      {/* 상품 목록 */}
      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {loading && (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-green-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3">
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
            </svg>
            <p className="text-sm">등록된 상품이 없습니다</p>
            <Link href="/products/new" className="mt-3 text-sm text-green-primary font-medium">
              상품 등록하기 →
            </Link>
          </div>
        )}

        {filtered.map((product) => (
          <ProductCard key={product.id} product={product} storeId={storeId} />
        ))}
      </div>
    </main>
  )
}

function ProductCard({
  product,
  storeId,
}: {
  product: Product
  storeId: string | null
}) {
  const { data: session } = useSession()
  const [toggling, setToggling] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleToggleActive() {
    setToggling(true)
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/stores/${storeId}/products/${product.id}/active`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.user.accessToken}`,
          },
          body: JSON.stringify({ isActive: !product.isActive }),
        }
      )
    } finally {
      setToggling(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`"${product.name}" 상품을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return
    setDeleting(true)
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/stores/${storeId}/products/${product.id}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session?.user.accessToken}` },
        }
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 flex gap-3">
      {/* 이미지 */}
      <div className="w-16 h-16 rounded-xl bg-gray-100 flex-shrink-0 overflow-hidden">
        {product.images[0] ? (
          <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </div>
        )}
      </div>

      {/* 정보 */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 text-sm truncate">{product.name}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {CATEGORY_LABEL[product.category]} · ₩{product.price.toLocaleString()}
          {product.saleType === 'group' && ' · 공동구매'}
        </p>
        <div className="flex items-center gap-2 mt-2">
          {/* 활성/비활성 토글 */}
          <button
            onClick={handleToggleActive}
            disabled={toggling}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
              product.isActive
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${product.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
            {product.isActive ? '판매 중' : '비활성'}
          </button>
          <Link
            href={`/products/${product.id}/edit`}
            className="text-xs text-gray-500 px-2.5 py-1 rounded-full bg-gray-100"
          >
            수정
          </Link>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs text-red-400 px-2.5 py-1 rounded-full bg-red-50 hover:bg-red-100 transition-colors"
          >
            {deleting ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
}
