'use client'

import { useState } from 'react'
import { useAdminOrders } from '@/hooks/useAdmin'

const STATUS_LABEL: Record<string, string> = {
  PENDING: '결제대기',
  RECRUITING: '모집중',
  ACCEPTED: '접수됨',
  CONFIRMED: '확정',
  PREPARING: '준비중',
  DELIVERING: '배달중',
  HUB_ARRIVED: '거점도착',
  PICKED_UP: '픽업완료',
  DELIVERED: '배달완료',
  REVIEWED: '리뷰완료',
  CANCELLED: '취소됨',
}

const REFUNDABLE = ['ACCEPTED', 'RECRUITING', 'CONFIRMED', 'PREPARING']

export default function AdminOrdersClient() {
  const [storeFilter, setStoreFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const { orders, loading, forceRefund } = useAdminOrders({
    storeId: storeFilter || undefined,
    status: statusFilter || undefined,
  })
  const [processingId, setProcessingId] = useState<string | null>(null)

  const handleRefund = async (orderId: string) => {
    const reason = prompt('환불 사유를 입력하세요 (선택사항)')
    if (reason === null) return
    setProcessingId(orderId)
    const ok = await forceRefund(orderId, reason || undefined)
    setProcessingId(null)
    if (!ok) alert('환불 처리에 실패했습니다.')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">
          전체 주문 <span className="text-sm font-normal text-gray-500">({orders.length})</span>
        </h2>
      </div>

      {/* 필터 */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="스토어 ID 필터"
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">전체 상태</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">불러오는 중...</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {orders.length === 0 ? (
            <div className="py-16 text-center text-gray-400">주문이 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">주문ID</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">스토어</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">상태</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">금액</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs text-gray-500">{order.id.slice(0, 12)}…</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs text-gray-500">{order.storeId.slice(0, 8)}…</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          order.status === 'CANCELLED'
                            ? 'bg-red-100 text-red-600'
                            : order.status === 'DELIVERED' || order.status === 'REVIEWED'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {STATUS_LABEL[order.status] ?? order.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      ₩{order.totalAmount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {REFUNDABLE.includes(order.status) && (
                        <button
                          onClick={() => handleRefund(order.id)}
                          disabled={processingId === order.id}
                          className="text-xs text-red-600 border border-red-300 px-3 py-1 rounded hover:bg-red-50 disabled:opacity-40"
                        >
                          {processingId === order.id ? '처리중…' : '강제환불'}
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
