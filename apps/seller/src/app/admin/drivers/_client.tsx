'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'

type DriverStatus = 'all' | 'pending' | 'approved' | 'suspended'

interface Driver {
  id: string
  name: string
  email: string | null
  driverApproved: boolean
  suspended?: boolean
  createdAt: { _seconds: number } | null
}

function useAdminDrivers(status: DriverStatus) {
  const { data: session } = useSession()
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    if (!session?.user?.accessToken) return
    setLoading(true)
    setError(null)
    const q = status !== 'all' ? `?status=${status}` : ''
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/drivers${q}`,
        { headers: { Authorization: `Bearer ${session.user.accessToken}` } },
      )
      const data = await res.json()
      if (res.ok) {
        setDrivers(data.drivers)
      } else {
        setError(`API 오류 ${res.status}: ${JSON.stringify(data)}`)
      }
    } catch (e) {
      setError(`네트워크 오류: ${String(e)}`)
    }
    setLoading(false)
  }, [session, status])

  useEffect(() => { fetch_() }, [fetch_])

  const approve = async (userId: string) => {
    if (!confirm('이 드라이버를 승인하시겠습니까?')) return
    await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/admin/drivers/${userId}/approve`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${session!.user.accessToken}` },
      },
    )
    fetch_()
  }

  const toggleSuspend = async (userId: string, suspended: boolean) => {
    const msg = suspended ? '이 드라이버를 정지하시겠습니까?' : '정지를 해제하시겠습니까?'
    if (!confirm(msg)) return
    await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/admin/drivers/${userId}/suspend`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session!.user.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ suspended }),
      },
    )
    fetch_()
  }

  return { drivers, loading, error, approve, toggleSuspend }
}

const STATUS_TABS: { value: DriverStatus; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'pending', label: '승인 대기' },
  { value: 'approved', label: '승인 완료' },
  { value: 'suspended', label: '정지됨' },
]

function driverBadge(driver: Driver) {
  if (driver.suspended)
    return <span className="text-xs bg-red-100 text-red-600 font-medium px-2 py-0.5 rounded-full">정지됨</span>
  if (driver.driverApproved)
    return <span className="text-xs bg-green-100 text-green-700 font-medium px-2 py-0.5 rounded-full">승인 완료</span>
  return <span className="text-xs bg-yellow-100 text-yellow-700 font-medium px-2 py-0.5 rounded-full">승인 대기</span>
}

export default function DriversClient() {
  const [tab, setTab] = useState<DriverStatus>('pending')
  const { drivers, loading, error, approve, toggleSuspend } = useAdminDrivers(tab)

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">드라이버 관리</h2>

      {/* 탭 */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.value
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-500 py-4 text-center bg-red-50 rounded-lg px-4">{error}</p>
      )}
      {loading ? (
        <p className="text-sm text-gray-500 py-8 text-center">불러오는 중...</p>
      ) : drivers.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">드라이버가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {drivers.map((driver) => (
            <div
              key={driver.id}
              className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium text-gray-900 text-sm truncate">{driver.name}</span>
                  {driverBadge(driver)}
                </div>
                <p className="text-xs text-gray-400 truncate">{driver.email ?? '이메일 없음'}</p>
              </div>

              <div className="flex gap-2 shrink-0">
                {!driver.driverApproved && !driver.suspended && (
                  <button
                    onClick={() => approve(driver.id)}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    승인
                  </button>
                )}
                {!driver.suspended ? (
                  <button
                    onClick={() => toggleSuspend(driver.id, true)}
                    className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium rounded-lg transition-colors"
                  >
                    정지
                  </button>
                ) : (
                  <button
                    onClick={() => toggleSuspend(driver.id, false)}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg transition-colors"
                  >
                    정지 해제
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
