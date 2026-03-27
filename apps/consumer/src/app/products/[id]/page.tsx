'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useProduct } from '@/hooks/useProducts'
import { useGroupProduct } from '@/hooks/useGroupProduct'
import { useDailyCap } from '@/hooks/useDailyCap'
import { useCart } from '@/hooks/useCart'
import type { SaleType, DeliveryMethod } from '@greenhub/shared'

const STORE_ID = 'dear-orchid'

const deliveryLabels: Record<DeliveryMethod, string> = {
  direct: '꽃차 직배송',
  hub: '거점 픽업',
  parcel: '택배',
}

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const { product, loading, error } = useProduct(id)
  const { config: groupConfig } = useGroupProduct(
    product?.saleType === 'group' ? id : null,
  )
  const { remainingSlots } = useDailyCap(STORE_ID)
  const { addItem } = useCart()

  const [quantity, setQuantity] = useState(1)
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('direct')
  const [groupConsent, setGroupConsent] = useState(false)

  if (loading) {
    return (
      <main className="max-w-lg mx-auto px-4 py-6">
        <div className="aspect-square rounded-2xl bg-gray-100 animate-pulse mb-4" />
        <div className="h-6 bg-gray-100 rounded animate-pulse mb-2 w-2/3" />
        <div className="h-8 bg-gray-100 rounded animate-pulse w-1/3" />
      </main>
    )
  }

  if (error || !product) {
    return (
      <main className="max-w-lg mx-auto px-4 py-16 text-center text-gray-400">
        <p className="text-4xl mb-3">😔</p>
        <p className="text-sm">{error ?? '상품을 찾을 수 없습니다.'}</p>
        <button
          onClick={() => router.back()}
          className="mt-4 text-green-primary text-sm underline"
        >
          돌아가기
        </button>
      </main>
    )
  }

  const isGroup = product.saleType === 'group'
  const unitPrice = product.price
  const totalAmount = unitPrice * quantity
  const canBuy = isGroup ? groupConsent : true

  function handleAddToCart() {
    if (!product) return
    addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      image: product.images?.[0] ?? '',
      saleType: product.saleType,
      deliveryMethod,
      storeId: STORE_ID,
      quantity,
    })
    router.push('/cart')
  }

  function handleBuyNow() {
    if (!product) return
    const params = new URLSearchParams({
      productId: product.id,
      quantity: String(quantity),
      saleType: product.saleType,
      deliveryMethod,
      totalAmount: String(totalAmount),
    })
    router.push(`/checkout?${params.toString()}`)
  }

  return (
    <main className="max-w-lg mx-auto">
      {/* 뒤로가기 */}
      <div className="px-4 pt-4">
        <button
          onClick={() => router.back()}
          className="text-gray-500 text-sm flex items-center gap-1"
        >
          ← 뒤로
        </button>
      </div>

      {/* 이미지 */}
      <div className="aspect-square bg-gray-50 overflow-hidden">
        <img
          src={product.images?.[0] ?? '/icons/icon-192x192.png'}
          alt={product.name}
          className="object-cover w-full h-full"
        />
      </div>

      {/* 정보 */}
      <div className="px-4 py-5 space-y-4">
        {isGroup && (
          <span className="inline-block bg-green-primary text-white text-xs font-bold px-2.5 py-1 rounded-full">
            공동구매
          </span>
        )}

        <h1 className="text-xl font-bold text-gray-900">{product.name}</h1>
        <p className="text-2xl font-bold text-green-dark">
          {unitPrice.toLocaleString()}원
        </p>

        {product.description && (
          <p className="text-sm text-gray-600 leading-relaxed">
            {product.description}
          </p>
        )}

        {/* 공동구매 실시간 정보 */}
        {isGroup && groupConfig && (
          <section className="bg-green-bg rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-bold text-green-dark">공동구매 현황</h3>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">현재 참여</span>
              <span className="font-semibold">
                {groupConfig.currentParticipants}/{groupConfig.maxParticipants}명
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">최소 인원</span>
              <span className="font-semibold">{groupConfig.minParticipants}명</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
              <div
                className="bg-green-primary rounded-full h-2 transition-all"
                style={{
                  width: `${Math.min(
                    (groupConfig.currentParticipants / groupConfig.minParticipants) * 100,
                    100,
                  )}%`,
                }}
              />
            </div>
            <p className="text-xs text-gray-400">
              마감:{' '}
              {new Date(groupConfig.recruitDeadline).toLocaleDateString('ko-KR', {
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </section>
        )}

        {/* Daily Cap */}
        {remainingSlots > 0 && (
          <p className="text-xs text-gray-400">
            🕐 오늘 잔여 배송 가능: <strong>{remainingSlots}건</strong>
          </p>
        )}

        {/* 배송 방법 */}
        <section>
          <h3 className="text-sm font-semibold mb-2">배송 방법</h3>
          <div className="flex gap-2">
            {(['direct', 'hub', 'parcel'] as DeliveryMethod[]).map((method) => (
              <button
                key={method}
                onClick={() => setDeliveryMethod(method)}
                className={`flex-1 py-2 px-3 text-xs rounded-lg border transition-colors ${
                  deliveryMethod === method
                    ? 'border-green-primary bg-green-bg text-green-dark font-semibold'
                    : 'border-gray-200 text-gray-500'
                }`}
              >
                {deliveryLabels[method]}
              </button>
            ))}
          </div>
        </section>

        {/* 수량 */}
        <section>
          <h3 className="text-sm font-semibold mb-2">수량</h3>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              className="w-9 h-9 border border-gray-200 rounded-lg flex items-center justify-center text-lg"
            >
              −
            </button>
            <span className="text-lg font-bold w-8 text-center">{quantity}</span>
            <button
              onClick={() => setQuantity(quantity + 1)}
              className="w-9 h-9 border border-gray-200 rounded-lg flex items-center justify-center text-lg"
            >
              +
            </button>
          </div>
        </section>

        {/* 공동구매 동의 */}
        {isGroup && (
          <label className="flex items-start gap-3 bg-yellow-50 rounded-xl p-4 cursor-pointer">
            <input
              type="checkbox"
              checked={groupConsent}
              onChange={(e) => setGroupConsent(e.target.checked)}
              className="mt-0.5 accent-green-primary"
            />
            <span className="text-sm text-gray-700 leading-relaxed">
              공동구매 <strong>확정 이후 취소·환불이 불가</strong>함을 이해하고
              동의합니다. (전자상거래법 제17조)
            </span>
          </label>
        )}

        {/* 합계 */}
        <div className="flex justify-between items-center pt-2 border-t">
          <span className="text-sm text-gray-500">총 금액</span>
          <span className="text-xl font-bold text-green-dark">
            {totalAmount.toLocaleString()}원
          </span>
        </div>

        {/* CTA 버튼 */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={handleAddToCart}
            className="flex-1 py-3.5 border-2 border-green-primary text-green-primary rounded-xl font-semibold text-sm hover:bg-green-bg transition-colors"
          >
            장바구니
          </button>
          <button
            onClick={handleBuyNow}
            disabled={!canBuy}
            className="flex-1 py-3.5 bg-green-primary text-white rounded-xl font-semibold text-sm disabled:opacity-40 hover:bg-green-dark transition-colors"
          >
            바로 결제
          </button>
        </div>
      </div>
    </main>
  )
}
