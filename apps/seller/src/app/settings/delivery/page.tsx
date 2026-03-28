'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'

interface DeliveryConfig {
  directFee: number
  hubFee: number
  parcelFee: number
  freeThresholdDirect: number
  freeThresholdHub: number
  freeThresholdParcel: number
  weatherRestrictionActive: boolean
}

const DEFAULTS: DeliveryConfig = {
  directFee: 3000,
  hubFee: 1000,
  parcelFee: 4000,
  freeThresholdDirect: 50000,
  freeThresholdHub: 30000,
  freeThresholdParcel: 50000,
  weatherRestrictionActive: false,
}

export default function DeliverySettingsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [config, setConfig] = useState<DeliveryConfig>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const storeId = session?.user.storeId
  const token = session?.user.accessToken

  useEffect(() => {
    if (!storeId || !token) return
    apiFetch(`/stores/${storeId}/delivery-config`, token)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) setConfig({ ...DEFAULTS, ...data })
      })
      .finally(() => setLoading(false))
  }, [storeId, token])

  function handleNum(field: keyof DeliveryConfig, value: string) {
    const num = parseInt(value, 10)
    if (!isNaN(num) && num >= 0) setConfig((prev) => ({ ...prev, [field]: num }))
  }

  async function handleSave() {
    if (!storeId || !token) return
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch(`/stores/${storeId}/delivery-config`, token, {
        method: 'PATCH',
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        setError('저장에 실패했습니다')
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">불러오는 중...</p>
      </main>
    )
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
          <h1 className="text-xl font-bold text-gray-900">배송비 설정</h1>
        </div>

        <div className="space-y-4">
          {/* 배송 방법별 기본 배송비 */}
          <section className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">기본 배송비</p>
            <div className="space-y-3">
              {([
                { label: '직배송', field: 'directFee' },
                { label: '거점 픽업', field: 'hubFee' },
                { label: '택배', field: 'parcelFee' },
              ] as { label: string; field: keyof DeliveryConfig }[]).map(({ label, field }) => (
                <div key={field} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-gray-700 w-24">{label}</span>
                  <div className="flex items-center gap-1 flex-1">
                    <input
                      type="number"
                      min="0"
                      step="500"
                      value={config[field] as number}
                      onChange={(e) => handleNum(field, e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm text-right focus:outline-none focus:border-green-primary"
                    />
                    <span className="text-sm text-gray-500 flex-shrink-0">원</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 무료 배송 기준 */}
          <section className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">무료 배송 기준금액</p>
            <div className="space-y-3">
              {([
                { label: '직배송', field: 'freeThresholdDirect' },
                { label: '거점 픽업', field: 'freeThresholdHub' },
                { label: '택배', field: 'freeThresholdParcel' },
              ] as { label: string; field: keyof DeliveryConfig }[]).map(({ label, field }) => (
                <div key={field} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-gray-700 w-24">{label}</span>
                  <div className="flex items-center gap-1 flex-1">
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={config[field] as number}
                      onChange={(e) => handleNum(field, e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm text-right focus:outline-none focus:border-green-primary"
                    />
                    <span className="text-sm text-gray-500 flex-shrink-0">원</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 기상 제한 토글 */}
          <section className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">기상 제한 배송</p>
                <p className="text-xs text-gray-400 mt-0.5">악천후 시 배송 제한 활성화</p>
              </div>
              <button
                onClick={() => setConfig((prev) => ({ ...prev, weatherRestrictionActive: !prev.weatherRestrictionActive }))}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  config.weatherRestrictionActive ? 'bg-green-primary' : 'bg-gray-200'
                }`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  config.weatherRestrictionActive ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          </section>

          {error && <p className="text-sm text-red-500 text-center">{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full font-medium py-3 rounded-xl transition-colors disabled:opacity-50 ${
              saved
                ? 'bg-blue-500 text-white'
                : 'bg-green-primary text-white hover:bg-green-dark'
            }`}
          >
            {saving ? '저장 중...' : saved ? '저장 완료!' : '저장'}
          </button>
        </div>
      </div>
    </main>
  )
}
