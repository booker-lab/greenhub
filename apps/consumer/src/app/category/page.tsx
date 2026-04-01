'use client'

import { useState } from 'react'
import ProductCard from '@/components/ProductCard'
import { useProducts } from '@/hooks/useProducts'
import type { Category } from '@greenhub/shared'

const TABS: { label: string; value: Category | undefined }[] = [
  { label: '전체', value: undefined },
  { label: '절화', value: 'cut_flower' },
  { label: '난', value: 'orchid' },
  { label: '관엽', value: 'foliage' },
]

export default function CategoryPage() {
  const [selected, setSelected] = useState<Category | undefined>(undefined)
  const { products, loading, error } = useProducts(selected)

  return (
    <main className="max-w-lg mx-auto pb-24">
      {/* 헤더 */}
      <div className="px-4 pt-6 pb-3">
        <h1 className="text-xl font-bold text-gray-800">카테고리</h1>
      </div>

      {/* 카테고리 탭 */}
      <div className="flex gap-2 px-4 pb-4 overflow-x-auto scrollbar-none">
        {TABS.map((tab) => {
          const isActive = selected === tab.value
          return (
            <button
              key={tab.label}
              onClick={() => setSelected(tab.value)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                isActive
                  ? 'bg-green-primary text-white border-green-primary'
                  : 'bg-white text-gray-500 border-gray-200'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* 상품 목록 */}
      <div className="px-4">
        {loading && (
          <div className="grid grid-cols-2 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="aspect-square rounded-2xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="text-center py-12 text-gray-400 text-sm">{error}</div>
        )}

        {!loading && !error && products.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">🌱</p>
            <p className="text-sm">해당 카테고리 상품이 없습니다.</p>
          </div>
        )}

        {!loading && products.length > 0 && (
          <>
            <p className="text-xs text-gray-400 mb-3">{products.length}개 상품</p>
            <div className="grid grid-cols-2 gap-3">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
