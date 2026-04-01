'use client'

import { useState } from 'react'
import { useAdminStores } from '@/hooks/useAdmin'

const STATUS_LABEL: Record<string, string> = {
  active: '운영중',
  invited: '초대됨',
  suspended: '정지',
}

export default function AdminStoresClient() {
  const { stores, loading, setCommission } = useAdminStores()
  const [editId, setEditId] = useState<string | null>(null)
  const [rateInput, setRateInput] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async (storeId: string) => {
    const rate = parseFloat(rateInput)
    if (isNaN(rate) || rate < 0 || rate > 1) {
      alert('0~1 사이의 수수료율을 입력하세요 (예: 0.05 = 5%)')
      return
    }
    setSaving(true)
    const ok = await setCommission(storeId, rate)
    setSaving(false)
    if (ok) {
      setEditId(null)
      setRateInput('')
    }
  }

  if (loading) {
    return (
      <div className="text-center py-20 text-gray-400">불러오는 중...</div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">
          판매자 목록 <span className="text-sm font-normal text-gray-500">({stores.length})</span>
        </h2>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {stores.length === 0 ? (
          <div className="py-16 text-center text-gray-400">등록된 판매자가 없습니다.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">상호</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">상태</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">수수료율</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {stores.map((store) => (
                <tr key={store.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{store.name || '(미설정)'}</p>
                    <p className="text-xs text-gray-400 font-mono">{store.id.slice(0, 8)}…</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        store.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : store.status === 'invited'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {STATUS_LABEL[store.status] ?? store.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {editId === store.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="1"
                          value={rateInput}
                          onChange={(e) => setRateInput(e.target.value)}
                          className="w-20 border border-gray-300 rounded px-2 py-1 text-sm"
                          placeholder="0.05"
                        />
                        <button
                          onClick={() => handleSave(store.id)}
                          disabled={saving}
                          className="text-xs bg-green-600 text-white px-2 py-1 rounded disabled:opacity-50"
                        >
                          저장
                        </button>
                        <button
                          onClick={() => { setEditId(null); setRateInput('') }}
                          className="text-xs text-gray-500 px-2 py-1 rounded hover:bg-gray-100"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-700">
                        {store.commissionRate !== undefined
                          ? `${(store.commissionRate * 100).toFixed(1)}%`
                          : '기본'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editId !== store.id && (
                      <button
                        onClick={() => {
                          setEditId(store.id)
                          setRateInput(String(store.commissionRate ?? ''))
                        }}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        수수료 설정
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
