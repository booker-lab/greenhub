'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCart } from '@/hooks/useCart'

export default function CartPage() {
  const router = useRouter()
  const { items, updateQuantity, removeItem, clearCart, totalAmount, itemCount } =
    useCart()

  function handleCheckout() {
    if (items.length === 0) return
    // 첫 번째 아이템 기준으로 checkout 이동 (MVP)
    const first = items[0]
    const params = new URLSearchParams({
      productId: first.productId,
      quantity: String(first.quantity),
      saleType: first.saleType,
      deliveryMethod: first.deliveryMethod,
      totalAmount: String(totalAmount),
    })
    router.push(`/checkout?${params.toString()}`)
  }

  if (items.length === 0) {
    return (
      <main className="max-w-lg mx-auto px-4 py-16 text-center">
        <p className="text-5xl mb-4">🛒</p>
        <p className="text-gray-500 mb-6">장바구니가 비어있습니다.</p>
        <Link
          href="/"
          className="inline-block bg-green-primary text-white px-6 py-3 rounded-xl text-sm font-semibold"
        >
          쇼핑하러 가기
        </Link>
      </main>
    )
  }

  return (
    <main className="max-w-lg mx-auto px-4 pt-6 pb-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">장바구니</h1>
        <button
          onClick={clearCart}
          className="text-xs text-gray-400 underline"
        >
          전체 삭제
        </button>
      </div>

      {/* 아이템 목록 */}
      <div className="space-y-3 mb-6">
        {items.map((item) => (
          <div
            key={item.productId}
            className="flex gap-3 p-3 rounded-xl border border-gray-100 bg-white"
          >
            {/* 이미지 */}
            <Link
              href={`/products/${item.productId}`}
              className="shrink-0 w-20 h-20 rounded-lg bg-gray-50 overflow-hidden"
            >
              <img
                src={item.image || '/icons/icon-192x192.png'}
                alt={item.name}
                className="w-full h-full object-cover"
              />
            </Link>

            {/* 정보 */}
            <div className="flex-1 min-w-0">
              <Link
                href={`/products/${item.productId}`}
                className="text-sm font-semibold text-gray-800 truncate block"
              >
                {item.name}
              </Link>

              {item.saleType === 'group' && (
                <span className="inline-block mt-0.5 text-[10px] bg-green-pale text-green-dark px-1.5 py-0.5 rounded-full font-semibold">
                  공동구매
                </span>
              )}

              <p className="text-base font-bold text-green-dark mt-1">
                {(item.price * item.quantity).toLocaleString()}원
              </p>

              {/* 수량 조절 */}
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                  className="w-7 h-7 border border-gray-200 rounded-md flex items-center justify-center text-sm"
                >
                  −
                </button>
                <span className="text-sm font-semibold w-6 text-center">
                  {item.quantity}
                </span>
                <button
                  onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                  className="w-7 h-7 border border-gray-200 rounded-md flex items-center justify-center text-sm"
                >
                  +
                </button>
                <button
                  onClick={() => removeItem(item.productId)}
                  className="ml-auto text-xs text-gray-400"
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 합계 */}
      <section className="bg-gray-50 rounded-xl p-4 mb-4">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-500">상품 수</span>
          <span>{itemCount}개</span>
        </div>
        <div className="flex justify-between">
          <span className="font-semibold">총 결제 금액</span>
          <span className="text-xl font-bold text-green-dark">
            {totalAmount.toLocaleString()}원
          </span>
        </div>
      </section>

      {/* 결제 버튼 */}
      <button
        onClick={handleCheckout}
        className="w-full py-4 bg-green-primary text-white rounded-xl font-bold text-base hover:bg-green-dark transition-colors"
      >
        결제하기
      </button>
    </main>
  )
}
