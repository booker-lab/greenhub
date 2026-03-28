'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useOrders, TAB_STATUSES } from '@/hooks/useOrders'
import type { Order, OrderStatus } from '@greenhub/shared'

type StatusTab = 'pending' | 'preparing' | 'delivering' | 'done' | 'cancelled'

const TABS: { key: StatusTab; label: string }[] = [
  { key: 'pending', label: '처리 필요' },
  { key: 'preparing', label: '준비 중' },
  { key: 'delivering', label: '배송 중' },
  { key: 'done', label: '완료' },
  { key: 'cancelled', label: '취소' },
]

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: '대기',
  RECRUITING: '모집 중',
  CONFIRMED: '주문 확정',
  ACCEPTED: '결제 완료',
  PREPARING: '준비 중',
  DELIVERING: '배송 중',
  HUB_ARRIVED: '거점 도착',
  PICKED_UP: '픽업 완료',
  DELIVERED: '배송 완료',
  CANCELLED: '취소',
  REVIEWED: '구매 확정',
}

const STATUS_COLOR: Record<OrderStatus, string> = {
  ACCEPTED: 'bg-orange-100 text-orange-600',
  CONFIRMED: 'bg-orange-100 text-orange-600',
  RECRUITING: 'bg-orange-100 text-orange-600',
  PREPARING: 'bg-blue-100 text-blue-600',
  DELIVERING: 'bg-purple-100 text-purple-600',
  HUB_ARRIVED: 'bg-purple-100 text-purple-600',
  CANCELLED: 'bg-red-100 text-red-600',
  PENDING: 'bg-gray-100 text-gray-600',
  DELIVERED: 'bg-green-100 text-green-700',
  PICKED_UP: 'bg-green-100 text-green-700',
  REVIEWED: 'bg-green-100 text-green-700',
}

const DELIVERY_LABEL: Record<string, string> = {
  direct: '꽃차 직배송',
  hub: '거점 픽업',
  parcel: '택배',
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  return `${Math.floor(hr / 24)}일 전`
}

export default function OrdersPage() {
  const { data: session } = useSession()
  const storeId = session?.user.storeId ?? null
  const { orders, loading, error, counts } = useOrders(storeId)
  const [activeTab, setActiveTab] = useState<StatusTab>('pending')

  const filteredOrders = orders.filter((o) =>
    TAB_STATUSES[activeTab].includes(o.status)
  )

  return (
    <main className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">주문 관리</h1>
          <div className="flex items-center gap-1.5">
            {loading ? (
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            ) : error ? (
              <span className="w-2 h-2 rounded-full bg-red-400" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-green-500" />
            )}
            <span className="text-xs text-gray-500">
              {loading ? '연결 중' : error ? '연결 오류' : '실시간 연결'}
            </span>
          </div>
        </div>
      </header>

      {/* 상태 탭 */}
      <div className="bg-white border-b border-gray-100 sticky top-[57px] z-10">
        <div className="max-w-lg mx-auto flex overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-green-primary text-green-primary'
                  : 'border-transparent text-gray-500'
              }`}
            >
              {tab.label}
              {counts[tab.key] > 0 && (
                <span className={`ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full ${
                  tab.key === 'pending'
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {counts[tab.key]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 주문 목록 */}
      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {loading && (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-green-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && filteredOrders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <p className="text-sm">현재 해당 주문이 없습니다</p>
          </div>
        )}

        {filteredOrders.map((order) => (
          <OrderCard key={order.id} order={order} storeId={storeId} />
        ))}
      </div>
    </main>
  )
}

function OrderCard({ order, storeId }: { order: Order; storeId: string | null }) {
  const router = useRouter()
  const { data: session } = useSession()
  const [actionLoading, setActionLoading] = useState(false)
  const [showPrepareForm, setShowPrepareForm] = useState(false)
  const [preparedAtInput, setPreparedAtInput] = useState('')

  async function handleStatusChange(status: OrderStatus, extra?: { cancelReason?: string; preparedAt?: string }) {
    setActionLoading(true)
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/stores/${storeId}/orders/${order.id}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.user.accessToken}`,
          },
          body: JSON.stringify({ status, ...extra }),
        }
      )
    } finally {
      setActionLoading(false)
    }
  }

  async function handlePrepare() {
    const extra = preparedAtInput
      ? { preparedAt: new Date(preparedAtInput).toISOString() }
      : undefined
    await handleStatusChange('PREPARING', extra)
    setShowPrepareForm(false)
    setPreparedAtInput('')
  }

  async function handleCancel() {
    const reason = prompt('취소 사유를 입력하세요 (필수)')
    if (!reason) return
    await handleStatusChange('CANCELLED', { cancelReason: reason })
  }

  const canPrepare = order.status === 'ACCEPTED' || order.status === 'CONFIRMED'
  // 발송(DELIVERING) 이전까지만 취소 가능
  const canCancel = order.status === 'ACCEPTED' || order.status === 'CONFIRMED' || order.status === 'PREPARING'

  return (
    <div
      className="bg-white rounded-2xl shadow-sm p-4 cursor-pointer active:bg-gray-50 transition-colors"
      onClick={() => router.push(`/orders/${order.id}`)}
    >
      {/* 상단: 상태 뱃지 + 시간 */}
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_COLOR[order.status]}`}>
          {STATUS_LABEL[order.status]}
        </span>
        <span className="text-xs text-gray-400">{formatRelativeTime(order.createdAt)}</span>
      </div>

      {/* 주문 정보 */}
      <p className="font-semibold text-gray-900 text-sm mb-1">
        주문 #{order.id.slice(-6).toUpperCase()}
      </p>
      <p className="text-sm text-gray-600 mb-1">
        {DELIVERY_LABEL[order.deliveryMethod]}
        {order.requestedDeliveryDate && ` · ${order.requestedDeliveryDate}`}
      </p>
      <p className="text-base font-bold text-gray-900 mb-3">
        ₩{order.totalAmount.toLocaleString()}
      </p>

      {/* 준비 시작 폼 */}
      {showPrepareForm && (
        <div className="mb-3 p-3 bg-gray-50 rounded-xl space-y-2" onClick={(e) => e.stopPropagation()}>
          <p className="text-xs text-gray-500">드라이버 수거 예정 시간 (선택)</p>
          <input
            type="datetime-local"
            value={preparedAtInput}
            onChange={(e) => setPreparedAtInput(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={handlePrepare}
              disabled={actionLoading}
              className="flex-1 bg-green-primary text-white text-sm font-medium py-2 rounded-xl disabled:opacity-50"
            >
              확인
            </button>
            <button
              onClick={() => { setShowPrepareForm(false); setPreparedAtInput('') }}
              className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2 rounded-xl"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 액션 버튼 */}
      {!showPrepareForm && (canPrepare || canCancel) && (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          {canPrepare && (
            <button
              onClick={() => setShowPrepareForm(true)}
              disabled={actionLoading}
              className="flex-1 bg-green-primary text-white text-sm font-medium py-2 rounded-xl disabled:opacity-50"
            >
              준비 시작
            </button>
          )}
          {canCancel && (
            <button
              onClick={handleCancel}
              disabled={actionLoading}
              className="flex-1 border border-red-300 text-red-500 text-sm font-medium py-2 rounded-xl disabled:opacity-50"
            >
              강제 취소
            </button>
          )}
        </div>
      )}

      {order.status === 'HUB_ARRIVED' && order.pickupCode && (
        <div className="mt-2 bg-green-bg rounded-xl p-3 text-center">
          <p className="text-xs text-gray-500 mb-1">픽업 코드</p>
          <p className="text-2xl font-bold tracking-widest text-green-primary">{order.pickupCode}</p>
        </div>
      )}
    </div>
  )
}
