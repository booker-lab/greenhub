'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'

export default function NewHubPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    address: '',
    addressDetail: '',
    operatingHours: '',
  })

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const storeId = session?.user.storeId
    const token = session?.user.accessToken
    if (!storeId || !token) return

    setError('')
    setLoading(true)
    try {
      const res = await apiFetch(`/stores/${storeId}/hubs`, token, {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          address: form.address,
          addressDetail: form.addressDetail || undefined,
          operatingHours: form.operatingHours || undefined,
        }),
      })
      if (res.ok) {
        router.push('/hubs')
      } else {
        const data = await res.json()
        setError(data.message ?? '저장에 실패했습니다')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-sm mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-gray-900">거점 등록</h1>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              거점 이름 <span className="text-red-500">*</span>
            </label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              required
              placeholder="예: 강남 거점"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              주소 <span className="text-red-500">*</span>
            </label>
            <input
              name="address"
              value={form.address}
              onChange={handleChange}
              required
              placeholder="거점 주소"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              상세 주소 <span className="text-gray-400 font-normal">(선택)</span>
            </label>
            <input
              name="addressDetail"
              value={form.addressDetail}
              onChange={handleChange}
              placeholder="동/호수, 층 등"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              운영 시간 <span className="text-gray-400 font-normal">(선택)</span>
            </label>
            <input
              name="operatingHours"
              value={form.operatingHours}
              onChange={handleChange}
              placeholder="예: 09:00~18:00"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-primary"
            />
          </div>

          {error && <p className="text-xs text-red-500 text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-primary text-white font-medium py-3 rounded-xl hover:bg-green-dark transition-colors disabled:opacity-50 mt-2"
          >
            {loading ? '등록 중...' : '거점 등록'}
          </button>
        </form>
      </div>
    </main>
  )
}
