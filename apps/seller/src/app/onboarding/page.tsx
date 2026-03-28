'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'

export default function OnboardingPage() {
  const { data: session, update } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    ceoName: '',
    phone: '',
    address: '',
    businessNumber: '',
    logoUrl: '',
  })

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session?.user.storeId && !form.name) {
      setError('상호명을 입력해주세요.')
      return
    }
    setError('')
    setLoading(true)

    const storeId = session?.user.storeId
    const token = session?.user.accessToken
    if (!token) {
      setError('로그인 정보를 확인해주세요.')
      setLoading(false)
      return
    }

    const body = JSON.stringify({
      name: form.name,
      ceoName: form.ceoName,
      phone: form.phone,
      address: form.address,
      businessNumber: form.businessNumber || undefined,
      logoUrl: form.logoUrl || undefined,
    })

    let res: Response
    if (!storeId) {
      // 신규 seller — 스토어 생성
      res = await apiFetch('/stores', token, { method: 'POST', body })
      if (res.ok) {
        const data = await res.json()
        await update({ storeId: data.storeId })
      }
    } else {
      res = await apiFetch(`/stores/${storeId}`, token, { method: 'PATCH', body })
    }

    setLoading(false)

    if (!res.ok) {
      setError('저장에 실패했습니다. 다시 시도해주세요.')
      return
    }

    router.push('/orders')
  }

  return (
    <main className="min-h-screen bg-green-bg px-4 py-8">
      <div className="max-w-sm mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-xl font-bold text-gray-900">사업자 정보 등록</h1>
          <p className="text-sm text-gray-500 mt-1">서비스 시작 전 한 번만 입력합니다</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              상호명 <span className="text-red-500">*</span>
            </label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              required
              placeholder="예: 디어 오키드"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              대표자명 <span className="text-red-500">*</span>
            </label>
            <input
              name="ceoName"
              value={form.ceoName}
              onChange={handleChange}
              required
              placeholder="예: 홍길동"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              연락처 <span className="text-red-500">*</span>
            </label>
            <input
              name="phone"
              value={form.phone}
              onChange={handleChange}
              required
              placeholder="010-0000-0000"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              소재지 <span className="text-red-500">*</span>
            </label>
            <input
              name="address"
              value={form.address}
              onChange={handleChange}
              required
              placeholder="사업장 주소"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-primary"
            />
          </div>

          <hr className="border-gray-100" />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              사업자등록번호 <span className="text-gray-400 font-normal">(선택)</span>
            </label>
            <input
              name="businessNumber"
              value={form.businessNumber}
              onChange={handleChange}
              placeholder="000-00-00000"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-primary"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-primary text-white font-medium py-3 rounded-xl hover:bg-green-dark transition-colors disabled:opacity-50 mt-2"
          >
            {loading ? '저장 중...' : '저장 후 시작하기'}
          </button>
        </form>
      </div>
    </main>
  )
}
