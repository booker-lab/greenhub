'use client'

import { useState } from 'react'
import { useAdminSettlements } from '@/hooks/useAdmin'

const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  confirmed: '확정',
  paid: '지급완료',
  cancelled: '취소',
}

export default function AdminSettlementsClient() {
  const [storeFilter, setStoreFilter] = useState('')
  const [fromFilter, setFromFilter] = useState('')
  const [toFilter, setToFilter] = useState('')
  const { settlements, loading, markAsPaid } = useAdminSettlements({
    storeId: storeFilter || undefined,
    from: fromFilter || undefined,
    to: toFilter || undefined,
  })
  const [processingId, setProcessingId] = useState<string | null>(null)

  const handlePay = async (settlementId: string) => {
    if (!confirm('이 정산을 지급 완료 처리하시겠습니까?')) return
    setProcessingId(settlementId)
    const ok = await markAsPaid(settlementId)
    setProcessingId(null)
    if (!ok) alert('처리에 실패했습니다.')
  }

  const totalNet = settlements.reduce((sum, s) => sum + s.netAmount, 0)
  const totalFee = settlements.reduce((sum, s) => sum + s.platformFee, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">
          정산 목록 <span className="text-sm font-normal text-gray-500">({settlements.length})</span>
        </h2>
      </div>

      {/* 필터 */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="스토어 ID 필터"
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
          className="flex-1 min-w-[140px] border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={fromFilter}
          onChange={(e) => setFromFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={toFilter}
          onChange={(e) => setToFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {/* 요약 카드 */}
      {settlements.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs text-gray-500 mb-1">플랫폼 수수료 합계</p>
            <p className="text-lg font-bold text-gray-900">₩{totalFee.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs text-gray-500 mb-1">판매자 지급 합계</p>
            <p className="text-lg font-bold text-green-700">₩{totalNet.toLocaleString()}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-400">불러오는 중...</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {settlements.length === 0 ? (
            <div className="py-16 text-center text-gray-400">정산 내역이 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">스토어</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">거래금액</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">수수료</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">지급액</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">상태</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {settlements.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs text-gray-500">{s.storeId.slice(0, 8)}…</p>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      ₩{s.totalAmount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-red-500">
                      ₩{s.platformFee.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-green-700">
                      ₩{s.netAmount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          s.status === 'paid'
                            ? 'bg-green-100 text-green-700'
                            : s.status === 'confirmed'
                            ? 'bg-blue-100 text-blue-700'
                            : s.status === 'cancelled'
                            ? 'bg-red-100 text-red-500'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {STATUS_LABEL[s.status] ?? s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {s.status === 'confirmed' && (
                        <button
                          onClick={() => handlePay(s.id)}
                          disabled={processingId === s.id}
                          className="text-xs text-blue-600 border border-blue-300 px-3 py-1 rounded hover:bg-blue-50 disabled:opacity-40"
                        >
                          {processingId === s.id ? '처리중…' : '지급처리'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
