'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'

type SettlementTab = 'daily' | 'period' | 'orders'
type SettlementStatus = 'pending' | 'confirmed' | 'paid' | 'cancelled'

interface Settlement {
  id: string
  orderId: string
  totalAmount: number
  platformFee: number
  netAmount: number
  status: SettlementStatus
  settledAt: { _seconds: number }
}

interface Summary {
  date: string
  count: number
  totalAmount: number
  totalPlatformFee: number
  totalNetAmount: number
  byStatus: Record<SettlementStatus, number>
}

const STATUS_LABEL: Record<SettlementStatus, string> = {
  pending: '정산 대기',
  confirmed: '확정',
  paid: '지급 완료',
  cancelled: '취소',
}

const STATUS_COLOR: Record<SettlementStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
}

function toKRW(n: number) {
  return `₩${n.toLocaleString('ko-KR')}`
}

function toDateStr(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString('ko-KR', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function SettlementsPage() {
  const { data: session } = useSession()
  const [activeTab, setActiveTab] = useState<SettlementTab>('daily')

  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')

  const storeId = session?.user.storeId
  const token = session?.user.accessToken

  const today = new Date().toISOString().split('T')[0]
  const todayLabel = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  })

  const fetchSummary = useCallback(async () => {
    if (!storeId || !token) return
    setSummaryLoading(true)
    try {
      const res = await apiFetch(
        `/stores/${storeId}/settlements/summary?date=${today}`,
        token,
      )
      if (res.ok) setSummary(await res.json())
    } finally {
      setSummaryLoading(false)
    }
  }, [storeId, token, today])

  const fetchSettlements = useCallback(async (f?: string, t?: string) => {
    if (!storeId || !token) return
    setListLoading(true)
    setListError('')
    try {
      const params = new URLSearchParams()
      if (f) params.set('from', f)
      if (t) params.set('to', t)
      const res = await apiFetch(
        `/stores/${storeId}/settlements?${params.toString()}`,
        token,
      )
      if (res.ok) {
        const data = await res.json()
        setSettlements(data.settlements)
      } else {
        setListError('조회에 실패했습니다')
      }
    } finally {
      setListLoading(false)
    }
  }, [storeId, token])

  useEffect(() => {
    if (activeTab === 'daily') fetchSummary()
    if (activeTab === 'orders') fetchSettlements()
  }, [activeTab, fetchSummary, fetchSettlements])

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto">
          <h1 className="text-lg font-bold text-gray-900">정산 관리</h1>
        </div>
      </header>

      <div className="bg-white border-b border-gray-100 sticky top-[57px] z-10">
        <div className="max-w-lg mx-auto flex">
          {([
            { key: 'daily', label: '일별 요약' },
            { key: 'period', label: '기간별 조회' },
            { key: 'orders', label: '주문별 상세' },
          ] as { key: SettlementTab; label: string }[]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-green-primary text-green-primary'
                  : 'border-transparent text-gray-500'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4">
        {/* 일별 요약 */}
        {activeTab === 'daily' && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-sm text-gray-500 mb-4">{todayLabel}</p>
            {summaryLoading ? (
              <p className="text-sm text-gray-400 text-center py-4">불러오는 중...</p>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">완료 건수</span>
                  <span className="font-semibold text-gray-900">{summary?.count ?? 0}건</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">총 매출</span>
                  <span className="font-semibold text-gray-900">{toKRW(summary?.totalAmount ?? 0)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">플랫폼 수수료</span>
                  <span className="text-sm text-gray-500">−{toKRW(summary?.totalPlatformFee ?? 0)}</span>
                </div>
                <hr className="border-gray-100" />
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">정산 예정</span>
                  <span className="font-bold text-green-primary">{toKRW(summary?.totalNetAmount ?? 0)}</span>
                </div>
                {summary && summary.count > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-50 grid grid-cols-2 gap-1">
                    {(Object.entries(summary.byStatus) as [SettlementStatus, number][])
                      .filter(([, v]) => v > 0)
                      .map(([status, count]) => (
                        <span key={status} className={`text-xs px-2 py-1 rounded-full ${STATUS_COLOR[status]}`}>
                          {STATUS_LABEL[status]} {count}건
                        </span>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 기간별 조회 */}
        {activeTab === 'period' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <p className="text-sm text-gray-500 mb-4">조회 기간을 선택하세요</p>
              <div className="flex gap-2 mb-4">
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm"
                />
                <span className="flex items-center text-gray-400">~</span>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm"
                />
              </div>
              <button
                onClick={() => fetchSettlements(from, to)}
                disabled={listLoading}
                className="w-full bg-green-primary text-white py-3 rounded-xl text-sm font-medium disabled:opacity-50"
              >
                {listLoading ? '조회 중...' : '조회'}
              </button>
            </div>

            {listError && <p className="text-sm text-red-500 text-center">{listError}</p>}

            {settlements.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400 px-1">{settlements.length}건 조회됨</p>
                {settlements.map((s) => (
                  <div key={s.id} className="bg-white rounded-xl px-4 py-3 shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-400">{s.orderId.slice(0, 8)}…</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[s.status]}`}>
                        {STATUS_LABEL[s.status]}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">{toDateStr(s.settledAt._seconds)}</span>
                      <span className="font-semibold text-gray-900">{toKRW(s.netAmount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 주문별 상세 */}
        {activeTab === 'orders' && (
          <div>
            {listLoading ? (
              <p className="text-sm text-gray-400 text-center py-20">불러오는 중...</p>
            ) : settlements.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <p className="text-sm">정산 완료된 주문이 없습니다</p>
              </div>
            ) : (
              <div className="space-y-2">
                {settlements.map((s) => (
                  <div key={s.id} className="bg-white rounded-xl px-4 py-3 shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-400">{s.orderId.slice(0, 8)}…</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[s.status]}`}>
                        {STATUS_LABEL[s.status]}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm text-gray-600">{toDateStr(s.settledAt._seconds)}</p>
                        <p className="text-xs text-gray-400">수수료 {toKRW(s.platformFee)}</p>
                      </div>
                      <span className="font-semibold text-gray-900">{toKRW(s.netAmount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
