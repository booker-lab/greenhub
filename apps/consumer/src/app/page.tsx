'use client'

import ProductCard from '@/components/ProductCard'
import { useProducts } from '@/hooks/useProducts'

export default function HomePage() {
  const { products, loading, error } = useProducts()

  return (
    <main className="max-w-lg mx-auto px-4 pt-6 pb-4">
      {/* 헤더 */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-green-primary">Green Hub</h1>
        <p className="text-sm text-gray-500 mt-1">
          신선한 화훼, 직거래로 만나세요.
        </p>
      </header>

      {/* 공동구매 안내 배너 */}
      <section className="mb-6 rounded-2xl bg-gradient-to-r from-green-primary to-green-dark text-white p-5">
        <h2 className="text-lg font-bold mb-1">🌿 공동구매</h2>
        <p className="text-sm opacity-90">
          함께 구매하면 배송비를 절약할 수 있어요.
        </p>
      </section>

      {/* 상품 목록 */}
      <section>
        <h2 className="text-lg font-bold mb-3">전체 상품</h2>

        {loading && (
          <div className="grid grid-cols-2 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="aspect-square rounded-2xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm">{error}</p>
          </div>
        )}

        {!loading && !error && products.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-4xl mb-3">🌱</p>
            <p className="text-sm">등록된 상품이 없습니다.</p>
          </div>
        )}

        {!loading && products.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
