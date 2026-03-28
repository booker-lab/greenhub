'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'

interface DailyCap {
  date: string
  totalCap: number
  usedSlots?: number
}

function buildCalendar(year: number, month: number): (string | null)[][] {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const weeks: (string | null)[][] = []
  let week: (string | null)[] = Array(firstDay).fill(null)

  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(month + 1).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    week.push(`${year}-${mm}-${dd}`)
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null)
    weeks.push(week)
  }
  return weeks
}

export default function DailyCapsPage() {
  const { data: session } = useSession()
  const router = useRouter()

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())

  const [caps, setCaps] = useState<Record<string, DailyCap>>({})
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)

  const storeId = session?.user.storeId
  const token = session?.user.accessToken

  const fetchCaps = useCallback(async () => {
    if (!storeId || !token) return
    setLoading(true)
    const mm = String(month + 1).padStart(2, '0')
    const from = `${year}-${mm}-01`
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const to = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`
    try {
      const res = await apiFetch(
        `/stores/${storeId}/daily-caps?from=${from}&to=${to}`,
        token,
      )
      if (res.ok) {
        const data = await res.json()
        const map: Record<string, DailyCap> = {}
        for (const cap of data.caps) map[cap.date] = cap
        setCaps(map)
      }
    } finally {
      setLoading(false)
    }
  }, [storeId, token, year, month])

  useEffect(() => { fetchCaps() }, [fetchCaps])

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11) }
    else setMonth((m) => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0) }
    else setMonth((m) => m + 1)
  }

  function startEdit(date: string) {
    setEditing(date)
    setEditValue(String(caps[date]?.totalCap ?? 0))
  }

  async function saveCap(date: string) {
    if (!storeId || !token) return
    const totalCap = parseInt(editValue, 10)
    if (isNaN(totalCap) || totalCap < 0) return
    setSaving(true)
    try {
      const res = await apiFetch(
        `/stores/${storeId}/daily-caps/${date}`,
        token,
        { method: 'PATCH', body: JSON.stringify({ totalCap }) },
      )
      if (res.ok) {
        setCaps((prev) => ({ ...prev, [date]: { ...prev[date], date, totalCap } }))
        setEditing(null)
      }
    } finally {
      setSaving(false)
    }
  }

  const calendar = buildCalendar(year, month)
  const todayStr = now.toISOString().split('T')[0]
  const monthLabel = new Date(year, month).toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long',
  })

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-sm mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-gray-900">배송 슬롯 설정</h1>
        </div>

        <p className="text-xs text-gray-400 mb-4 leading-relaxed">
          날짜를 탭하면 해당 날짜의 최대 배송 슬롯(총 수량)을 설정할 수 있습니다.
        </p>

        {/* 월 이동 */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="p-1 text-gray-500 hover:text-gray-700">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <span className="font-semibold text-gray-900">{monthLabel}</span>
            <button onClick={nextMonth} className="p-1 text-gray-500 hover:text-gray-700">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>

          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 mb-1">
            {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
              <div key={d} className="text-center text-xs text-gray-400 py-1">{d}</div>
            ))}
          </div>

          {/* 날짜 그리드 */}
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">불러오는 중...</div>
          ) : (
            calendar.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7">
                {week.map((date, di) => {
                  if (!date) return <div key={di} />
                  const cap = caps[date]
                  const isToday = date === todayStr
                  const isPast = date < todayStr
                  return (
                    <button
                      key={date}
                      onClick={() => !isPast && startEdit(date)}
                      disabled={isPast}
                      className={`flex flex-col items-center py-1.5 rounded-xl transition-colors ${
                        isPast ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer'
                      } ${isToday ? 'bg-green-50' : ''}`}
                    >
                      <span className={`text-xs font-medium ${isToday ? 'text-green-primary' : 'text-gray-700'}`}>
                        {parseInt(date.split('-')[2], 10)}
                      </span>
                      <span className={`text-xs mt-0.5 ${cap ? 'text-blue-600 font-semibold' : 'text-gray-300'}`}>
                        {cap ? cap.totalCap : '—'}
                      </span>
                      {cap && (cap.usedSlots ?? 0) > 0 && (
                        <span className="text-[10px] text-gray-400">{cap.usedSlots}↑</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* 편집 패널 */}
        {editing && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-sm font-medium text-gray-800 mb-3">
              {editing} 슬롯 설정
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-sm text-right focus:outline-none focus:border-green-primary"
                autoFocus
              />
              <span className="text-sm text-gray-500">개</span>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">0 = 해당일 배송 불가</p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setEditing(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600"
              >
                취소
              </button>
              <button
                onClick={() => saveCap(editing)}
                disabled={saving}
                className="flex-1 py-2.5 bg-green-primary text-white rounded-xl text-sm font-medium disabled:opacity-50"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
