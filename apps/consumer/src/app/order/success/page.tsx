'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useOrderStatus } from '@/hooks/useOrderStatus'
import type { OrderStatus } from '@greenhub/shared'

const STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING: '결제 확인 중...',
  RECRUITING: '공동구매 모집 중',
  ACCEPTED: '주문 접수 완료',
  PREPARING: '상품 준비 중',
  DELIVERING: '배송 중',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '주문 취소',
  REVIEWED: '리뷰 완료',
}

const SUCCESS_STATUSES: OrderStatus[] = ['ACCEPTED', 'RECRUITING']

function OrderSuccessContent() {
  const params = useSearchParams()
  const router = useRouter()
  const orderId = params.get('orderId')

  const { order, loading, error } = useOrderStatus(orderId)

  // CANCELLED 시 홈으로 이동
  useEffect(() => {
    if (order?.status === 'CANCELLED') {
      const timer = setTimeout(() => router.replace('/'), 4000)
      return () => clearTimeout(timer)
    }
  }, [order?.status, router])

  if (!orderId) {
    router.replace('/')
    return null
  }

  const isPending = !loading && order?.status === 'PENDING'
  const isSuccess = !loading && order && SUCCESS_STATUSES.includes(order.status)
  const isCancelled = !loading && order?.status === 'CANCELLED'

  return (
    <main
      style={{
        padding: '60px 24px 40px',
        maxWidth: '480px',
        margin: '0 auto',
        textAlign: 'center',
      }}
    >
      {/* 초기 로딩 또는 PENDING */}
      {(loading || isPending) && (
        <>
          <div style={{ fontSize: '56px', marginBottom: '20px' }}>⏳</div>
          <h1 style={{ fontSize: '20px', fontWeight: 'bold' }}>결제 확인 중...</h1>
          <p style={{ color: '#666', marginTop: '10px', fontSize: '14px' }}>
            잠시만 기다려주세요. 결제 완료 후 자동으로 업데이트됩니다.
          </p>
        </>
      )}

      {/* 성공 */}
      {isSuccess && (
        <>
          <div style={{ fontSize: '56px', marginBottom: '20px' }}>✅</div>
          <h1 style={{ fontSize: '22px', fontWeight: 'bold' }}>주문이 완료되었습니다</h1>
          <p style={{ color: '#2D6A4F', marginTop: '10px', fontWeight: '600' }}>
            {STATUS_LABELS[order.status]}
          </p>
          {order.status === 'RECRUITING' && (
            <p style={{ color: '#666', fontSize: '13px', marginTop: '8px' }}>
              공동구매 목표 달성 시 주문이 확정됩니다.
            </p>
          )}
          <p style={{ color: '#999', fontSize: '12px', marginTop: '16px' }}>
            주문번호: {orderId}
          </p>
          <button
            onClick={() => router.push('/mypage')}
            style={{
              marginTop: '32px',
              padding: '14px 40px',
              background: '#2D6A4F',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '15px',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            주문 내역 보기
          </button>
          <button
            onClick={() => router.push('/')}
            style={{
              display: 'block',
              margin: '12px auto 0',
              background: 'none',
              border: 'none',
              color: '#666',
              fontSize: '14px',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            홈으로
          </button>
        </>
      )}

      {/* 취소 */}
      {isCancelled && (
        <>
          <div style={{ fontSize: '56px', marginBottom: '20px' }}>❌</div>
          <h1 style={{ fontSize: '20px', fontWeight: 'bold' }}>결제가 취소되었습니다</h1>
          <p style={{ color: '#666', marginTop: '10px', fontSize: '14px' }}>
            {order.cancelReason ?? '결제 처리 중 오류가 발생했습니다.'}
          </p>
          <p style={{ color: '#999', fontSize: '13px', marginTop: '16px' }}>
            잠시 후 홈 화면으로 이동합니다.
          </p>
        </>
      )}

      {/* Firestore 오류 */}
      {!loading && error && (
        <>
          <div style={{ fontSize: '56px', marginBottom: '20px' }}>⚠️</div>
          <h1 style={{ fontSize: '20px', fontWeight: 'bold' }}>주문 정보를 불러올 수 없습니다</h1>
          <p style={{ color: '#666', marginTop: '10px', fontSize: '14px' }}>{error}</p>
          <button
            onClick={() => router.push('/')}
            style={{
              marginTop: '24px',
              padding: '12px 32px',
              background: '#2D6A4F',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
            }}
          >
            홈으로
          </button>
        </>
      )}
    </main>
  )
}

export default function OrderSuccessPage() {
  return (
    <Suspense fallback={<div style={{ padding: '60px 24px', textAlign: 'center' }}>로딩 중...</div>}>
      <OrderSuccessContent />
    </Suspense>
  )
}
