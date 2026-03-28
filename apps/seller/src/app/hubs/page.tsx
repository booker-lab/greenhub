'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

interface Hub {
  id: string
  name: string
  address: string
  addressDetail: string | null
  operatingHours: string | null
  isActive: boolean
}

export default function HubsPage() {
  const { data: session } = useSession()
  const [hubs, setHubs] = useState<Hub[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const storeId = session?.user.storeId
  const token = session?.user.accessToken

  const fetchHubs = useCallback(async () => {
    if (!storeId || !token) return
    setLoading(true)
    try {
      const res = await apiFetch(`/stores/${storeId}/hubs`, token)
      if (res.ok) {
        const data = await res.json()
        setHubs(data.hubs)
      }
    } finally {
      setLoading(false)
    }
  }, [storeId, token])

  useEffect(() => { fetchHubs() }, [fetchHubs])

  async function toggleActive(hub: Hub) {
    if (!storeId || !token) return
    const res = await apiFetch(`/stores/${storeId}/hubs/${hub.id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !hub.isActive }),
    })
    if (res.ok) {
      setHubs((prev) =>
        prev.map((h) => h.id === hub.id ? { ...h, isActive: !hub.isActive } : h)
      )
    }
  }

  async function deleteHub(hubId: string) {
    if (!storeId || !token) return
    if (!confirm('거점을 삭제하시겠습니까?')) return
    const res = await apiFetch(`/stores/${storeId}/hubs/${hubId}`, token, {
      method: 'DELETE',
    })
    if (res.ok) {
      setHubs((prev) => prev.filter((h) => h.id !== hubId))
    } else {
      setError('삭제에 실패했습니다')
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">거점 관리</h1>
          <Link
            href="/hubs/new"
            className="flex items-center gap-1 bg-green-primary text-white text-sm font-medium px-3 py-1.5 rounded-lg"
          >
            <span>+</span> 거점 등록
          </Link>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4">
        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

        {loading ? (
          <p className="text-sm text-gray-400 text-center py-20">불러오는 중...</p>
        ) : hubs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <p className="text-sm">등록된 거점이 없습니다</p>
            <Link href="/hubs/new" className="mt-3 text-sm text-green-primary font-medium">
              거점 등록하기 →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {hubs.map((hub) => (
              <div key={hub.id} className="bg-white rounded-2xl px-4 py-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/hubs/${hub.id}`} className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-gray-900 text-sm truncate">{hub.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                        hub.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {hub.isActive ? '운영 중' : '비활성'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">{hub.address}</p>
                    {hub.addressDetail && (
                      <p className="text-xs text-gray-400">{hub.addressDetail}</p>
                    )}
                    {hub.operatingHours && (
                      <p className="text-xs text-gray-400 mt-1">운영: {hub.operatingHours}</p>
                    )}
                  </Link>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button
                      onClick={() => toggleActive(hub)}
                      className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-lg"
                    >
                      {hub.isActive ? '비활성화' : '활성화'}
                    </button>
                    <button
                      onClick={() => deleteHub(hub.id)}
                      className="text-xs text-red-500 bg-red-50 px-2 py-1 rounded-lg"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
