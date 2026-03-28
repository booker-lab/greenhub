'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useOrderStatus } from '@/hooks/useOrderStatus'
import type { Order, OrderStatus } from '@greenhub/shared'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const STORE_ID = 'dear-orchid'

// ──────────────────────────────────────────────
// 상태 표시 설정
// ──────────────────────────────────────────────
const STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING: '결제 확인 중',
  RECRUITING: '모집 중',
  CONFIRMED: '주문 확정',
  ACCEPTED: '결제 완료',
  PREPARING: '상품 준비 중',
  DELIVERING: '배송 중',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '주문 취소',
  REVIEWED: '구매 확정',
}

// 판매 유형·배송 방식별 타임라인 스텝 정의
function getTimelineSteps(order: Order): OrderStatus[] {
  if (order.saleType === 'group') {
    return ['RECRUITING', 'CONFIRMED', 'PREPARING', 'DELIVERING', 'DELIVERED']
  }
  if (order.deliveryMethod === 'hub') {
    return ['ACCEPTED', 'PREPARING', 'DELIVERING', 'HUB_ARRIVED', 'PICKED_UP']
  }
  return ['ACCEPTED', 'PREPARING', 'DELIVERING', 'DELIVERED']
}

// 스텝 내 현재 인덱스 (REVIEWED는 마지막 스텝 완료로 취급)
function getCurrentStepIndex(steps: OrderStatus[], status: OrderStatus): number {
  if (status === 'REVIEWED') return steps.length - 1
  return steps.indexOf(status)
}

// ──────────────────────────────────────────────
// 타임라인 스텝 컴포넌트
// ──────────────────────────────────────────────
function TimelineStep({
  label,
  state,
  isLast,
}: {
  label: string
  state: 'done' | 'current' | 'pending'
  isLast: boolean
}) {
  const circleColor =
    state === 'done' ? '#2D6A4F' : state === 'current' ? '#2D6A4F' : '#e0e0e0'
  const textColor =
    state === 'done' ? '#2D6A4F' : state === 'current' ? '#111' : '#aaa'
  const fontWeight = state === 'current' ? '700' : '400'

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
      {/* 아이콘 + 연결선 */}
      <div
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}
      >
        <div
          style={{
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            background: circleColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: state === 'current' ? '3px solid #2D6A4F' : 'none',
            boxSizing: 'border-box',
          }}
        >
          {state === 'done' && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
          {state === 'current' && (
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#fff' }} />
          )}
        </div>
        {!isLast && (
          <div
            style={{
              width: '2px',
              height: '32px',
              background: state === 'done' ? '#2D6A4F' : '#e0e0e0',
              marginTop: '2px',
            }}
          />
        )}
      </div>

      {/* 레이블 */}
      <div style={{ paddingTop: '2px', paddingBottom: isLast ? 0 : '32px' }}>
        <span style={{ fontSize: '14px', color: textColor, fontWeight }}>{label}</span>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// 픽업 코드 카드
// ──────────────────────────────────────────────
function PickupCodeCard({ code, address }: { code: string; address: string }) {
  return (
    <div
      style={{
        border: '2px solid #2D6A4F',
        borderRadius: '10px',
        padding: '16px',
        background: '#f0faf4',
        textAlign: 'center',
        marginBottom: '16px',
      }}
    >
      <div style={{ fontSize: '13px', color: '#2D6A4F', fontWeight: '600', marginBottom: '8px' }}>
        픽업 코드
      </div>
      <div style={{ fontSize: '32px', fontWeight: '800', letterSpacing: '6px', color: '#111' }}>
        {code}
      </div>
      <div style={{ fontSize: '12px', color: '#555', marginTop: '10px' }}>
        수령 장소: {address}
      </div>
      <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
        코드를 제시하고 수령하세요
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// 메인 컴포넌트
// ──────────────────────────────────────────────
export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: orderId } = use(params)
  const router = useRouter()
  const { data: session } = useSession()
  const { order, loading, error } = useOrderStatus(orderId)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  async function handleConfirm() {
    if (!session?.user?.accessToken) return
    setConfirming(true)
    try {
      const res = await fetch(`${API_URL}/stores/${STORE_ID}/orders/${orderId}/review`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.user.accessToken}`,
        },
      })
      if (res.ok) setConfirmed(true)
    } finally {
      setConfirming(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center', color: '#999' }}>로딩 중...</div>
    )
  }

  if (error || !order) {
    return (
      <main style={{ padding: '24px 16px', maxWidth: '480px', margin: '0 auto' }}>
        <button onClick={() => router.back()} style={backBtnStyle}>← 뒤로</button>
        <div style={{ textAlign: 'center', color: '#C62828', padding: '40px 0', fontSize: '14px' }}>
          주문 정보를 불러올 수 없습니다.
        </div>
      </main>
    )
  }

  const steps = getTimelineSteps(order)
  const isCancelled = order.status === 'CANCELLED'
  const isReviewable =
    !confirmed &&
    order.status !== 'REVIEWED' &&
    (order.status === 'DELIVERED' || order.status === 'PICKED_UP')
  const currentIdx = getCurrentStepIndex(steps, order.status)
  const showPickupCode =
    order.pickupCode &&
    (order.status === 'HUB_ARRIVED' || order.status === 'PICKED_UP' || order.status === 'REVIEWED')

  return (
    <main style={{ padding: '24px 16px 80px', maxWidth: '480px', margin: '0 auto' }}>
      {/* 헤더 */}
      <button onClick={() => router.back()} style={backBtnStyle}>← 뒤로</button>
      <h1 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '4px' }}>주문 상세</h1>
      <p style={{ fontSize: '12px', color: '#999', marginBottom: '20px' }}>
        주문번호: {orderId}
      </p>

      {/* 주문 정보 요약 */}
      <div
        style={{
          background: '#f8f8f8',
          borderRadius: '10px',
          padding: '14px 16px',
          marginBottom: '24px',
          fontSize: '13px',
          color: '#555',
          lineHeight: '1.7',
        }}
      >
        <div>
          <strong>배송 방식</strong>:{' '}
          {order.deliveryMethod === 'hub'
            ? '거점 픽업'
            : order.deliveryMethod === 'parcel'
              ? '택배'
              : '직배송'}
          {order.saleType === 'group' && ' (공동구매)'}
        </div>
        {order.deliveryAddress?.address && (
          <div>
            <strong>배송지</strong>: {order.deliveryAddress.address}{' '}
            {order.deliveryAddress.addressDetail}
          </div>
        )}
        {order.requestedDeliveryDate && (
          <div>
            <strong>배송 희망일</strong>: {order.requestedDeliveryDate}
          </div>
        )}
        <div>
          <strong>결제 금액</strong>: {order.totalAmount.toLocaleString('ko-KR')}원
        </div>
      </div>

      {/* 취소 상태 */}
      {isCancelled && (
        <div
          style={{
            background: '#fff3f3',
            border: '1px solid #ffcdd2',
            borderRadius: '10px',
            padding: '16px',
            marginBottom: '24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>❌</div>
          <div style={{ fontWeight: '700', color: '#C62828', marginBottom: '4px' }}>
            주문이 취소되었습니다
          </div>
          {order.cancelReason && (
            <div style={{ fontSize: '13px', color: '#888' }}>사유: {order.cancelReason}</div>
          )}
        </div>
      )}

      {/* 픽업 코드 */}
      {showPickupCode && (
        <PickupCodeCard
          code={order.pickupCode!}
          address={order.deliveryAddress?.address ?? ''}
        />
      )}

      {/* 구매 확정 버튼 */}
      {(isReviewable || confirmed) && (
        <button
          onClick={handleConfirm}
          disabled={confirming || confirmed}
          style={{
            width: '100%',
            padding: '14px',
            background: confirmed ? '#e8f5e9' : '#2D6A4F',
            color: confirmed ? '#2D6A4F' : '#fff',
            border: confirmed ? '1px solid #2D6A4F' : 'none',
            borderRadius: '8px',
            fontSize: '15px',
            fontWeight: 'bold',
            cursor: confirming || confirmed ? 'default' : 'pointer',
            marginBottom: '24px',
          }}
        >
          {confirmed ? '✓ 구매 확정 완료' : confirming ? '처리 중...' : '구매 확정'}
        </button>
      )}

      {/* 상태 타임라인 */}
      {!isCancelled && (
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '16px' }}>배송 현황</h2>
          <div style={{ paddingLeft: '4px' }}>
            {steps.map((stepStatus, idx) => {
              const state =
                idx < currentIdx ? 'done' : idx === currentIdx ? 'current' : 'pending'
              const label =
                stepStatus === 'DELIVERED' && order.status === 'REVIEWED'
                  ? '배송 완료 · 구매 확정'
                  : (STATUS_LABELS[stepStatus] ?? stepStatus)
              return (
                <TimelineStep
                  key={stepStatus}
                  label={label}
                  state={state}
                  isLast={idx === steps.length - 1}
                />
              )
            })}
          </div>
        </div>
      )}
    </main>
  )
}

const backBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: '14px',
  color: '#555',
  cursor: 'pointer',
  padding: '0 0 16px 0',
  display: 'block',
}
