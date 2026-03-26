'use client'

import { Suspense, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams, useRouter } from 'next/navigation'
import { usePayment } from '@/hooks/usePayment'
import type { CreateOrderRequest, DeliveryAddress, DeliveryMethod, SaleType } from '@greenhub/shared'

// MVP 고정값
const STORE_ID = 'dear-orchid'

function CheckoutContent() {
  const { data: session } = useSession()
  const params = useSearchParams()
  const router = useRouter()

  const productId = params.get('productId') ?? ''
  const quantity = Number(params.get('quantity') ?? 1)
  const saleType = (params.get('saleType') ?? 'normal') as SaleType
  const deliveryMethod = (params.get('deliveryMethod') ?? 'direct') as DeliveryMethod
  const totalAmount = Number(params.get('totalAmount') ?? 0)

  const [address, setAddress] = useState<DeliveryAddress>({
    address: '',
    addressDetail: '',
    zipCode: '',
  })

  const orderRequest: CreateOrderRequest = {
    productId,
    quantity,
    saleType,
    deliveryMethod,
    deliveryAddress: address,
  }

  const { state, orderId, error, requestPayment } = usePayment({
    storeId: STORE_ID,
    orderRequest,
    accessToken: session?.user?.accessToken ?? '',
  })

  // 결제창 닫힘 → 완료 화면 이동 (Firestore 리스너가 상태 추적)
  if (state === 'done' && orderId) {
    router.replace(`/order/success?orderId=${orderId}`)
    return null
  }

  const isLoading = state === 'creating' || state === 'paying'
  const canPay = !isLoading && !!address.address && !!address.zipCode && !!session

  const deliveryLabels: Record<DeliveryMethod, string> = {
    direct: '꽃차 직배송',
    hub: '거점 픽업',
    parcel: '택배',
  }

  return (
    <main style={{ padding: '24px', maxWidth: '480px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '24px' }}>결제</h1>

      {/* 주문 요약 */}
      <section style={{ marginBottom: '24px', padding: '16px', background: '#f9f9f9', borderRadius: '8px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '12px' }}>주문 정보</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '14px' }}>
          <dt style={{ color: '#666' }}>수량</dt>
          <dd style={{ textAlign: 'right' }}>{quantity}개</dd>
          <dt style={{ color: '#666' }}>배송 방법</dt>
          <dd style={{ textAlign: 'right' }}>{deliveryLabels[deliveryMethod]}</dd>
          {totalAmount > 0 && (
            <>
              <dt style={{ color: '#666', fontWeight: '600' }}>결제 금액</dt>
              <dd style={{ textAlign: 'right', fontWeight: '600' }}>
                {totalAmount.toLocaleString()}원
              </dd>
            </>
          )}
        </dl>
      </section>

      {/* 배송지 입력 */}
      <section style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '12px' }}>배송지</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <input
            type="text"
            placeholder="주소 *"
            value={address.address}
            onChange={(e) => setAddress((a) => ({ ...a, address: e.target.value }))}
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="상세 주소"
            value={address.addressDetail}
            onChange={(e) => setAddress((a) => ({ ...a, addressDetail: e.target.value }))}
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="우편번호 *"
            value={address.zipCode}
            onChange={(e) => setAddress((a) => ({ ...a, zipCode: e.target.value }))}
            style={inputStyle}
          />
        </div>
      </section>

      {/* 결제 수단 */}
      <section style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '8px' }}>결제 수단</h2>
        <div
          style={{
            padding: '14px',
            border: '2px solid #2D6A4F',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '14px',
          }}
        >
          <span>💛</span>
          <span style={{ fontWeight: '600' }}>카카오페이</span>
        </div>
      </section>

      {error && (
        <p style={{ color: '#e53e3e', marginBottom: '12px', fontSize: '14px' }}>{error}</p>
      )}

      <button
        onClick={requestPayment}
        disabled={!canPay}
        style={{
          width: '100%',
          padding: '16px',
          background: canPay ? '#2D6A4F' : '#a0aec0',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          fontSize: '16px',
          fontWeight: 'bold',
          cursor: canPay ? 'pointer' : 'not-allowed',
        }}
      >
        {state === 'creating'
          ? '주문 생성 중...'
          : state === 'paying'
            ? '결제 진행 중...'
            : '카카오페이로 결제하기'}
      </button>
    </main>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: '1px solid #ddd',
  borderRadius: '6px',
  fontSize: '14px',
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div style={{ padding: '24px' }}>로딩 중...</div>}>
      <CheckoutContent />
    </Suspense>
  )
}
