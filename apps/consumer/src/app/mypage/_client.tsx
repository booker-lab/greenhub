'use client'

import { useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useOrders } from '@/hooks/useOrders'
import A2HSButton from '@/components/A2HSButton'
import type { Order, OrderStatus } from '@greenhub/shared'

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

const STATUS_COLORS: Partial<Record<OrderStatus, string>> = {
  PENDING: '#999',
  RECRUITING: '#1565C0',
  CONFIRMED: '#1565C0',
  ACCEPTED: '#2D6A4F',
  PREPARING: '#2D6A4F',
  DELIVERING: '#E65100',
  HUB_ARRIVED: '#E65100',
  PICKED_UP: '#2D6A4F',
  DELIVERED: '#2D6A4F',
  CANCELLED: '#C62828',
  REVIEWED: '#555',
}

function formatDate(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

function OrderCard({ order, onClick }: { order: Order; onClick: () => void }) {
  const color = STATUS_COLORS[order.status] ?? '#555'
  const label = STATUS_LABELS[order.status] ?? order.status

  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: '#fff',
        border: '1px solid #e0e0e0',
        borderRadius: '10px',
        padding: '14px 16px',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize: '12px',
            fontWeight: '600',
            color,
            background: color + '18',
            padding: '2px 8px',
            borderRadius: '12px',
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: '12px', color: '#999' }}>{formatDate(order.createdAt)}</span>
      </div>
      <div style={{ marginTop: '8px', fontSize: '14px', color: '#333' }}>
        {order.saleType === 'group' ? '[공동구매] ' : ''}
        {order.deliveryMethod === 'hub'
          ? '거점 픽업'
          : order.deliveryMethod === 'parcel'
            ? '택배'
            : '직배송'}
      </div>
      <div style={{ marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '13px', color: '#666' }}>수량 {order.quantity}개</span>
        <span style={{ fontSize: '14px', fontWeight: '700', color: '#111' }}>
          {order.totalAmount.toLocaleString('ko-KR')}원
        </span>
      </div>
    </button>
  )
}

export default function MyPageClient() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { orders, loading, error } = useOrders()

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login')
    }
  }, [status, router])

  if (status === 'loading') {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center', color: '#999' }}>로딩 중...</div>
    )
  }

  if (!session) return null

  return (
    <main style={{ padding: '24px 16px 80px', maxWidth: '480px', margin: '0 auto' }}>
      {/* 프로필 */}
      <section style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '8px' }}>마이페이지</h1>
        <div
          style={{
            background: '#f5f5f5',
            borderRadius: '10px',
            padding: '14px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontWeight: '600', fontSize: '15px' }}>{session.user?.name ?? '사용자'}</div>
            <div style={{ fontSize: '13px', color: '#666', marginTop: '2px' }}>
              {session.user?.email}
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            style={{
              fontSize: '13px',
              color: '#999',
              background: 'none',
              border: '1px solid #ddd',
              borderRadius: '6px',
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            로그아웃
          </button>
        </div>
      </section>

      {/* 주문 내역 */}
      <section style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '12px' }}>주문 내역</h2>
        {loading && (
          <div style={{ textAlign: 'center', color: '#999', padding: '24px 0', fontSize: '14px' }}>
            불러오는 중...
          </div>
        )}
        {!loading && error && (
          <div style={{ color: '#C62828', fontSize: '14px', padding: '12px 0' }}>
            주문 내역을 불러올 수 없습니다.
          </div>
        )}
        {!loading && !error && orders.length === 0 && (
          <div style={{ textAlign: 'center', color: '#999', padding: '32px 0', fontSize: '14px' }}>
            주문 내역이 없습니다.
          </div>
        )}
        {!loading && orders.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onClick={() => router.push(`/mypage/orders/${order.id}`)}
              />
            ))}
          </div>
        )}
      </section>

      {/* 배송지 관리 */}
      <section style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '12px' }}>배송지 관리</h2>
        <button
          onClick={() => router.push('/mypage/addresses')}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            background: '#fff',
            border: '1px solid #e0e0e0',
            borderRadius: '10px',
            padding: '14px 16px',
            cursor: 'pointer',
            fontSize: '14px',
            color: '#333',
          }}
        >
          <span>배송지 목록 · 추가 · 수정</span>
          <span style={{ color: '#999', fontSize: '16px' }}>›</span>
        </button>
      </section>

      {/* 앱 설치 */}
      <section>
        <h2 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '12px' }}>앱 설치</h2>
        <A2HSButton />
      </section>
    </main>
  )
}
