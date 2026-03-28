'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'

interface Hub {
  id: string
  name: string
  address: string
  addressDetail: string | null
  operatingHours: string | null
  isActive: boolean
}

interface HubOrder {
  id: string
  orderId?: string
  status: string
  totalAmount: number
  createdAt: { seconds: number } | string
  items?: { name: string; quantity: number }[]
  customerName?: string
  pickupCode?: string
}

function formatTime(ts: { seconds: number } | string | undefined): string {
  if (!ts) return '-'
  const date =
    typeof ts === 'string'
      ? new Date(ts)
      : new Date((ts as { seconds: number }).seconds * 1000)
  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function HubDetailPage() {
  const { data: session } = useSession()
  const params = useParams()
  const router = useRouter()
  const hubId = params.id as string

  const [hub, setHub] = useState<Hub | null>(null)
  const [orders, setOrders] = useState<HubOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const storeId = session?.user.storeId
  const token = session?.user.accessToken

  const fetchData = useCallback(async () => {
    if (!storeId || !token) return
    setLoading(true)
    try {
      const [hubRes, ordersRes] = await Promise.all([
        apiFetch(`/stores/${storeId}/hubs/${hubId}`, token),
        apiFetch(`/stores/${storeId}/hubs/${hubId}/orders?status=HUB_ARRIVED`, token),
      ])

      if (!hubRes.ok) { setError('거점 정보를 불러올 수 없습니다'); return }
      if (!ordersRes.ok) { setError('주문 목록을 불러올 수 없습니다'); return }

      const hubData = await hubRes.json()
      const ordersData = await ordersRes.json()

      setHub(hubData)
      setOrders(ordersData.orders ?? [])
    } catch {
      setError('네트워크 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }, [storeId, token, hubId])

  useEffect(() => { fetchData() }, [fetchData])

  const orderId = (o: HubOrder) => o.id ?? o.orderId ?? ''

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-gray-900">
            {hub ? hub.name : '거점 상세'}
          </h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {error && <p className="text-sm text-red-500">{error}</p>}

        {loading ? (
          <p className="text-sm text-gray-400 text-center py-20">불러오는 중...</p>
        ) : hub ? (
          <>
            {/* 거점 정보 카드 */}
            <div className="bg-white rounded-2xl px-4 py-4 shadow-sm space-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  hub.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {hub.isActive ? '운영 중' : '비활성'}
                </span>
              </div>
              <p className="text-sm text-gray-700">{hub.address}</p>
              {hub.addressDetail && (
                <p className="text-xs text-gray-400">{hub.addressDetail}</p>
              )}
              {hub.operatingHours && (
                <p className="text-xs text-gray-500">운영시간: {hub.operatingHours}</p>
              )}
            </div>

            {/* 픽업 대기 주문 목록 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-gray-700">픽업 대기 주문</h2>
                <span className="text-xs text-gray-400">{orders.length}건</span>
              </div>

              {orders.length === 0 ? (
                <div className="bg-white rounded-2xl px-4 py-10 shadow-sm flex flex-col items-center text-gray-400">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-2">
                    <path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                  <p className="text-sm">픽업 대기 주문이 없습니다</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {orders.map((order) => (
                    <button
                      key={orderId(order)}
                      onClick={() =>
                        router.push(`/hubs/${hubId}/pickup?orderId=${orderId(order)}`)
                      }
                      className="w-full bg-white rounded-2xl px-4 py-4 shadow-sm text-left flex items-center justify-between gap-2 active:bg-gray-50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                            픽업 대기
                          </span>
                          <span className="text-xs text-gray-400">{formatTime(order.createdAt)}</span>
                        </div>
                        {order.items && order.items.length > 0 && (
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {order.items[0].name}
                            {order.items.length > 1 && ` 외 ${order.items.length - 1}건`}
                          </p>
                        )}
                        <p className="text-sm text-gray-500 mt-0.5">
                          {order.totalAmount?.toLocaleString()}원
                        </p>
                      </div>
                      <div className="flex-shrink-0 text-gray-300">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </main>
  )
}
