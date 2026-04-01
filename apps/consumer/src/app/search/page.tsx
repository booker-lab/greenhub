'use client'

import { useState, useMemo } from 'react'
import ProductCard from '@/components/ProductCard'
import { useProducts } from '@/hooks/useProducts'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const { products, loading, error } = useProducts() // 전체 로드 후 client-side filter

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q),
    )
  }, [query, products])

  const hasQuery = query.trim().length > 0

  return (
    <main className="max-w-lg mx-auto pb-24">
      {/* 검색창 */}
      <div className="sticky top-0 bg-white z-10 px-4 pt-5 pb-3 border-b border-gray-100">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="상품명을 검색하세요"
            autoFocus
            className="w-full pl-9 pr-4 py-2.5 bg-gray-100 rounded-xl text-sm outline-none focus:bg-gray-50 focus:ring-2 focus:ring-green-primary/30 transition"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg leading-none"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 결과 영역 */}
      <div className="px-4 pt-4">
        {/* 로딩 중 (전체 상품 초기 로드) */}
        {loading && (
          <div className="text-center py-12 text-gray-400 text-sm">불러오는 중...</div>
        )}

        {!loading && error && (
          <div className="text-center py-12 text-gray-400 text-sm">{error}</div>
        )}

        {/* 검색어 없음 */}
        {!loading && !error && !hasQuery && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-sm">찾고 싶은 상품을 검색해보세요.</p>
          </div>
        )}

        {/* 검색 결과 없음 */}
        {!loading && hasQuery && filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">😢</p>
            <p className="text-sm">
              <span className="font-semibold text-gray-600">"{query}"</span>에 대한 검색 결과가 없습니다.
            </p>
          </div>
        )}

        {/* 검색 결과 */}
        {!loading && hasQuery && filtered.length > 0 && (
          <>
            <p className="text-xs text-gray-400 mb-3">
              <span className="font-semibold text-gray-600">"{query}"</span> 검색 결과 {filtered.length}개
            </p>
            <div className="grid grid-cols-2 gap-3">
              {filtered.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
