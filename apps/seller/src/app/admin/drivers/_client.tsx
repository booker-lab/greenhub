'use client'

import { useState, useMemo } from 'react'
import { useAdminDrivers, AdminDriver, DriverStatus } from '@/hooks/useAdmin'

const STATUS_TABS: { value: DriverStatus; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'pending', label: '승인 대기' },
  { value: 'approved', label: '승인 완료' },
  { value: 'suspended', label: '정지됨' },
]

function DriverBadge({ driver }: { driver: AdminDriver }) {
  if (driver.suspended)
    return <span className="text-xs bg-red-100 text-red-600 font-medium px-2 py-0.5 rounded-full">정지됨</span>
  if (driver.driverApproved)
    return <span className="text-xs bg-green-100 text-green-700 font-medium px-2 py-0.5 rounded-full">승인 완료</span>
  return <span className="text-xs bg-yellow-100 text-yellow-700 font-medium px-2 py-0.5 rounded-full">승인 대기</span>
}

export default function DriversClient() {
  const [tab, setTab] = useState<DriverStatus>('pending')
  const [processingId, setProcessingId] = useState<string | null>(null)
  const { drivers: allDrivers, loading, approve, toggleSuspend } = useAdminDrivers()

  const drivers = useMemo(() => {
    if (tab === 'all') return allDrivers
    if (tab === 'pending') return allDrivers.filter(d => !d.driverApproved && !d.suspended)
    if (tab === 'approved') return allDrivers.filter(d => d.driverApproved && !d.suspended)
    if (tab === 'suspended') return allDrivers.filter(d => d.suspended)
    return allDrivers
  }, [allDrivers, tab])

  const handleApprove = async (userId: string) => {
    if (!confirm('이 드라이버를 승인하시겠습니까?')) return
    setProcessingId(userId)
    await approve(userId)
    setProcessingId(null)
  }

  const handleSuspend = async (userId: string, suspended: boolean) => {
    const msg = suspended ? '이 드라이버를 정지하시겠습니까?' : '정지를 해제하시겠습니까?'
    if (!confirm(msg)) return
    setProcessingId(userId)
    await toggleSuspend(userId, suspended)
    setProcessingId(null)
  }

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

      {loading ? (
        <div className="text-center py-20 text-gray-400">불러오는 중...</div>
      ) : drivers.length === 0 ? (
        <div className="text-center py-20 text-gray-400">드라이버가 없습니다.</div>
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
                  <DriverBadge driver={driver} />
                </div>
                <p className="text-xs text-gray-400 truncate">{driver.email ?? '이메일 없음'}</p>
              </div>

              <div className="flex gap-2 shrink-0">
                {!driver.driverApproved && !driver.suspended && (
                  <button
                    onClick={() => handleApprove(driver.id)}
                    disabled={processingId === driver.id}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
                  >
                    {processingId === driver.id ? '처리중…' : '승인'}
                  </button>
                )}
                {!driver.suspended ? (
                  <button
                    onClick={() => handleSuspend(driver.id, true)}
                    disabled={processingId === driver.id}
                    className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
                  >
                    정지
                  </button>
                ) : (
                  <button
                    onClick={() => handleSuspend(driver.id, false)}
                    disabled={processingId === driver.id}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
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
