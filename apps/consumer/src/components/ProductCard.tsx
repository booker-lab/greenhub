'use client'

import Link from 'next/link'
import type { Product } from '@greenhub/shared'

interface ProductCardProps {
  product: Product
}

const categoryLabels: Record<string, string> = {
  cut_flower: '절화',
  orchid: '난',
  foliage: '관엽',
}

export default function ProductCard({ product }: ProductCardProps) {
  const imgSrc = product.images?.[0] ?? '/icons/icon-192x192.png'

  return (
    <Link
      href={`/products/${product.id}`}
      className="group block rounded-2xl overflow-hidden bg-white border border-gray-100 shadow-sm hover:shadow-md transition-shadow"
    >
      {/* 이미지 */}
      <div className="relative aspect-square bg-gray-50 overflow-hidden">
        <img
          src={imgSrc}
          alt={product.name}
          className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300"
        />
        {product.saleType === 'group' && (
          <span className="absolute top-2 left-2 bg-green-primary text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
            공동구매
          </span>
        )}
      </div>

      {/* 정보 */}
      <div className="p-3">
        <p className="text-xs text-gray-400 mb-0.5">
          {categoryLabels[product.category] ?? product.category}
        </p>
        <h3 className="text-sm font-semibold text-gray-800 truncate">
          {product.name}
        </h3>
        <p className="text-base font-bold text-green-dark mt-1">
          {product.price.toLocaleString()}원
        </p>
        {product.colors.length > 0 && (
          <p className="text-[11px] text-gray-400 mt-1 truncate">
            {product.colors.slice(0, 3).join(' · ')}
            {product.colors.length > 3 && ` +${product.colors.length - 3}`}
          </p>
        )}
      </div>
    </Link>
  )
}
