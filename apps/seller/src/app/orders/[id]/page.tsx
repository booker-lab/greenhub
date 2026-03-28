'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { apiFetch } from '@/lib/api'
import type { Order, OrderStatus } from '@greenhub/shared'
import type { GroupProductConfig } from '@greenhub/shared'

// ────────────────────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────────────────────

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

// 판매자가 조작할 수 없는 읽기 전용 상태
// 발송(DELIVERING) 이후 판매자 취소 불가 — 소비자 반품 신청 루트로만 처리
const READONLY_STATUSES: OrderStatus[] = [
  'DELIVERING', 'HUB_ARRIVED', 'PICKED_UP', 'DELIVERED', 'REVIEWED', 'CANCELLED',
]

// 판매자 취소 가능 상태 (DELIVERING 이전까지만)
const CANCELLABLE_STATUSES: OrderStatus[] = ['ACCEPTED', 'CONFIRMED', 'PREPARING']

function toDatetimeLocalValue(iso: string): string {
  // ISO8601 → datetime-local input 포맷 (YYYY-MM-DDTHH:mm)
  return iso.slice(0, 16)
}

// ────────────────────────────────────────────────────────────
// 컴포넌트
// ────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const params = useParams()
  const router = useRouter()
  const orderId = params.id as string
  const { data: session } = useSession()
  const storeId = session?.user.storeId ?? null
  const token = session?.user.accessToken ?? ''

  const [order, setOrder] = useState<Order | null>(null)
  const [groupConfig, setGroupConfig] = useState<GroupProductConfig | null>(null)
  const [loading, setLoading] = useState(true)

  // 준비 시작 관련 상태
  const [showPrepareForm, setShowPrepareForm] = useState(false)
  const [preparedAtInput, setPreparedAtInput] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // 강제 취소 모달 상태
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  // ── Firestore 실시간 구독 ──
  useEffect(() => {
    if (!orderId) return
    const ref = doc(db, 'orders', orderId)
    const unsubscribe = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setOrder({ id: snap.id, ...snap.data() } as Order)
      }
      setLoading(false)
    })
    return unsubscribe
  }, [orderId])

  // ── 공동구매인 경우 groupProductConfig 로드 ──
  useEffect(() => {
    if (!order || order.saleType !== 'group') return
    const ref = doc(db, 'groupProductConfigs', order.productId)
    getDoc(ref).then((snap) => {
      if (snap.exists()) {
        setGroupConfig(snap.data() as GroupProductConfig)
      }
    })
  }, [order?.productId, order?.saleType])

  // ── preparedAt 기본값 설정 (폼 열릴 때) ──
  useEffect(() => {
    if (!showPrepareForm || !order) return
    if (preparedAtInput) return // 이미 입력값 있으면 덮어쓰지 않음

    const baseDate =
      order.saleType === 'normal'
        ? order.requestedDeliveryDate // 소비자 희망 배송일 (YYYY-MM-DD)
        : groupConfig?.groupDeliveryDate?.slice(0, 10) // 공동구매 배송 예정일

    if (baseDate) {
      // 날짜 기본값 설정, 시각은 09:00으로 초기화
      setPreparedAtInput(`${baseDate.slice(0, 10)}T09:00`)
    }
  }, [showPrepareForm, order, groupConfig, preparedAtInput])

  // ── 액션: 준비 시작 ──
  async function handlePrepare() {
    if (!storeId || !order) return
    setActionLoading(true)
    setActionError(null)
    try {
      const body: Record<string, string> = { status: 'PREPARING' }
      if (preparedAtInput) {
        body.preparedAt = new Date(preparedAtInput).toISOString()
      }
      const res = await apiFetch(
        `/stores/${storeId}/orders/${order.id}/status`,
        token,
        { method: 'PATCH', body: JSON.stringify(body) },
      )
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`)
      setShowPrepareForm(false)
      setPreparedAtInput('')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '오류가 발생했습니다')
    } finally {
      setActionLoading(false)
    }
  }

  // ── 액션: 강제 취소 ──
  async function handleCancel() {
    if (!storeId || !order) return
    if (cancelReason.trim().length < 5) return
    setActionLoading(true)
    setActionError(null)
    try {
      const res = await apiFetch(
        `/stores/${storeId}/orders/${order.id}/status`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: 'CANCELLED', reason: cancelReason.trim() }),
        },
      )
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`)
      setShowCancelModal(false)
      setCancelReason('')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '오류가 발생했습니다')
    } finally {
      setActionLoading(false)
    }
  }

  // ────────────────────────────────────────────────────────────
  // 렌더링
  // ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-green-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-3 text-gray-500">
        <p className="text-sm">주문을 찾을 수 없습니다</p>
        <button onClick={() => router.back()} className="text-sm text-green-primary underline">
          돌아가기
        </button>
      </div>
    )
  }

  const isReadonly = READONLY_STATUSES.includes(order.status)
  const canPrepare = order.status === 'ACCEPTED' || order.status === 'CONFIRMED'
  const canCancel = CANCELLABLE_STATUSES.includes(order.status)

  const deliveryDate =
    order.saleType === 'normal'
      ? order.requestedDeliveryDate
      : groupConfig?.groupDeliveryDate?.slice(0, 10) ?? null

  return (
    <main className="min-h-screen bg-gray-50 pb-24">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 p-1 -ml-1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-gray-900">주문 상세</h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">

        {/* 상태 + 주문번호 */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <span className={`text-sm font-semibold px-3 py-1 rounded-full ${STATUS_COLOR[order.status]}`}>
              {STATUS_LABEL[order.status]}
            </span>
            <span className="text-xs text-gray-400">
              {new Date(order.createdAt).toLocaleString('ko-KR', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </span>
          </div>
          <p className="text-base font-bold text-gray-900">
            주문 #{order.id.slice(-8).toUpperCase()}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {order.saleType === 'group' ? '공동구매' : '일반 판매'}
          </p>
        </div>

        {/* 상품 정보 */}
        <section className="bg-white rounded-2xl shadow-sm p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">상품 정보</h2>
          <Row label="상품 ID" value={order.productId} mono />
          <Row label="수량" value={`${order.quantity}개`} />
          <Row label="상품 금액" value={`₩${(order.totalAmount - order.deliveryFee).toLocaleString()}`} />
          <Row label="배송비" value={`₩${order.deliveryFee.toLocaleString()}`} />
          <div className="border-t border-gray-100 pt-2 mt-1">
            <Row label="결제 금액" value={`₩${order.totalAmount.toLocaleString()}`} bold />
          </div>
        </section>

        {/* 공동구매 현황 (공동구매인 경우만) */}
        {order.saleType === 'group' && groupConfig && (
          <section className="bg-white rounded-2xl shadow-sm p-4 space-y-2">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">공동구매 현황</h2>
            <Row
              label="참여 인원"
              value={`${groupConfig.currentParticipants} / ${groupConfig.maxParticipants}명 (최소 ${groupConfig.minParticipants}명)`}
            />
            <Row
              label="모집 마감일"
              value={new Date(groupConfig.recruitDeadline).toLocaleDateString('ko-KR')}
            />
            <Row
              label="배송 예정일"
              value={new Date(groupConfig.groupDeliveryDate).toLocaleDateString('ko-KR')}
            />
          </section>
        )}

        {/* 배송 정보 */}
        <section className="bg-white rounded-2xl shadow-sm p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">배송 정보</h2>
          <Row label="배송 수단" value={DELIVERY_LABEL[order.deliveryMethod]} />
          {order.saleType === 'normal' && order.requestedDeliveryDate && (
            <Row
              label="희망 배송일"
              value={new Date(order.requestedDeliveryDate).toLocaleDateString('ko-KR')}
              highlight
            />
          )}
          {order.deliveryMethod !== 'hub' ? (
            <>
              <Row label="주소" value={`${order.deliveryAddress.address} ${order.deliveryAddress.addressDetail}`} />
              <Row label="우편번호" value={order.deliveryAddress.zipCode} />
              <Row label="서울·경기" value={order.isMetropolitan ? '해당' : '해당 없음'} />
            </>
          ) : (
            order.pickupCode && (
              <div className="mt-2 bg-green-bg rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">픽업 코드</p>
                <p className="text-2xl font-bold tracking-widest text-green-primary">{order.pickupCode}</p>
              </div>
            )
          )}
          {order.preparedAt && (
            <Row
              label="수거 예정 시각"
              value={new Date(order.preparedAt).toLocaleString('ko-KR', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
              highlight
            />
          )}
        </section>

        {/* 취소 정보 */}
        {order.status === 'CANCELLED' && order.cancelReason && (
          <section className="bg-red-50 rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-red-600 mb-1">취소 사유</h2>
            <p className="text-sm text-red-500">{order.cancelReason}</p>
          </section>
        )}

        {/* 오류 메시지 */}
        {actionError && (
          <p className="text-sm text-red-500 text-center">{actionError}</p>
        )}

        {/* 준비 시작 폼 */}
        {showPrepareForm && (
          <section className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">드라이버 수거 예정 시각 설정</h2>
            {deliveryDate && (
              <p className="text-xs text-gray-500">
                {order.saleType === 'normal' ? '소비자 희망 배송일' : '공동구매 배송 예정일'}:{' '}
                <span className="font-medium text-gray-700">
                  {new Date(deliveryDate).toLocaleDateString('ko-KR')}
                </span>
              </p>
            )}
            <input
              type="datetime-local"
              value={preparedAtInput}
              onChange={(e) => setPreparedAtInput(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-primary"
            />
            <p className="text-xs text-gray-400">
              설정하지 않아도 준비 시작 처리는 가능합니다.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handlePrepare}
                disabled={actionLoading}
                className="flex-1 bg-green-primary text-white text-sm font-semibold py-3 rounded-xl disabled:opacity-50"
              >
                {actionLoading ? '처리 중...' : '준비 시작 확인'}
              </button>
              <button
                onClick={() => { setShowPrepareForm(false); setPreparedAtInput('') }}
                className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-3 rounded-xl"
              >
                취소
              </button>
            </div>
          </section>
        )}

        {/* 액션 버튼 */}
        {!isReadonly && !showPrepareForm && (
          <div className="space-y-2">
            {canPrepare && (
              <button
                onClick={() => setShowPrepareForm(true)}
                disabled={actionLoading}
                className="w-full bg-green-primary text-white text-sm font-semibold py-3.5 rounded-2xl disabled:opacity-50"
              >
                준비 시작
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => setShowCancelModal(true)}
                disabled={actionLoading}
                className="w-full border border-red-300 text-red-500 text-sm font-medium py-3.5 rounded-2xl disabled:opacity-50"
              >
                강제 취소
              </button>
            )}
          </div>
        )}

        {isReadonly && order.status !== 'CANCELLED' && (
          <p className="text-center text-xs text-gray-400 py-2">
            발송 이후 단계입니다. 취소가 필요한 경우 소비자 반품 신청을 통해 처리됩니다.
          </p>
        )}
      </div>

      {/* 강제 취소 모달 */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center px-4 pb-8">
          <div className="bg-white rounded-2xl w-full max-w-lg p-5 space-y-4">
            <h2 className="text-base font-bold text-gray-900">강제 취소</h2>
            <p className="text-sm text-gray-500">
              취소 사유를 입력하세요. 소비자에게 알림톡으로 전달됩니다.
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="취소 사유 입력 (최소 5자)"
              rows={3}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:border-red-400"
            />
            {cancelReason.length > 0 && cancelReason.trim().length < 5 && (
              <p className="text-xs text-red-400">최소 5자 이상 입력해주세요</p>
            )}
            {actionError && (
              <p className="text-xs text-red-500">{actionError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                disabled={actionLoading || cancelReason.trim().length < 5}
                className="flex-1 bg-red-500 text-white text-sm font-semibold py-3 rounded-xl disabled:opacity-40"
              >
                {actionLoading ? '처리 중...' : '취소 확정'}
              </button>
              <button
                onClick={() => { setShowCancelModal(false); setCancelReason(''); setActionError(null) }}
                className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-3 rounded-xl"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

// ────────────────────────────────────────────────────────────
// 헬퍼 컴포넌트
// ────────────────────────────────────────────────────────────

function Row({
  label,
  value,
  bold,
  highlight,
  mono,
}: {
  label: string
  value: string
  bold?: boolean
  highlight?: boolean
  mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-sm text-gray-500 shrink-0">{label}</span>
      <span className={`text-sm text-right break-all ${
        bold ? 'font-bold text-gray-900' :
        highlight ? 'font-medium text-green-primary' :
        mono ? 'font-mono text-gray-600' :
        'text-gray-700'
      }`}>
        {value}
      </span>
    </div>
  )
}
