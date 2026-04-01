'use client'

import { useState } from 'react'
import { useAdminUsers } from '@/hooks/useAdmin'

export default function AdminUsersClient() {
  const { users, loading, toggleSuspend } = useAdminUsers()
  const [processingId, setProcessingId] = useState<string | null>(null)

  const handleToggle = async (userId: string, currentlySuspended: boolean) => {
    if (!confirm(currentlySuspended ? '계정 정지를 해제하시겠습니까?' : '이 계정을 정지하시겠습니까?')) return
    setProcessingId(userId)
    await toggleSuspend(userId, !currentlySuspended)
    setProcessingId(null)
  }

  if (loading) {
    return <div className="text-center py-20 text-gray-400">불러오는 중...</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">
          소비자 계정 <span className="text-sm font-normal text-gray-500">({users.length})</span>
        </h2>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {users.length === 0 ? (
          <div className="py-16 text-center text-gray-400">등록된 소비자가 없습니다.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">이름</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">이메일</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">상태</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{user.name}</p>
                    <p className="text-xs text-gray-400 font-mono">{user.id.slice(0, 8)}…</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{user.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        user.suspended
                          ? 'bg-red-100 text-red-600'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {user.suspended ? '정지됨' : '정상'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleToggle(user.id, !!user.suspended)}
                      disabled={processingId === user.id}
                      className={`text-xs px-3 py-1 rounded border disabled:opacity-40 ${
                        user.suspended
                          ? 'border-green-300 text-green-700 hover:bg-green-50'
                          : 'border-red-300 text-red-600 hover:bg-red-50'
                      }`}
                    >
                      {processingId === user.id ? '처리중…' : user.suspended ? '복구' : '정지'}
                    </button>
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
