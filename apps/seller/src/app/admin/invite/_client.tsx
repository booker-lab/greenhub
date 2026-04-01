'use client'

import { useState } from 'react'
import { useAdminInvite } from '@/hooks/useAdmin'

export default function AdminInviteClient() {
  const { invites, loading, generating, generate } = useAdminInvite()
  const [lastToken, setLastToken] = useState<{ token: string; expiresAt: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const handleGenerate = async () => {
    const result = await generate()
    if (result) setLastToken(result)
  }

  const handleCopy = () => {
    if (!lastToken) return
    navigator.clipboard.writeText(lastToken.token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">초대 토큰 발급</h2>
      </div>

      {/* 발급 카드 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <p className="text-sm text-gray-600 mb-4">
          판매자 초대 토큰을 생성합니다. 토큰은 발급 후 <strong>7일간</strong> 유효합니다.
        </p>

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="bg-green-600 text-white text-sm font-medium px-5 py-2.5 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {generating ? '생성중…' : '새 토큰 생성'}
        </button>

        {lastToken && (
          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-xl">
            <p className="text-xs text-green-700 mb-2 font-medium">생성된 초대 토큰</p>
            <div className="flex items-center gap-3">
              <code className="flex-1 text-lg font-mono font-bold text-green-800 tracking-widest">
                {lastToken.token}
              </code>
              <button
                onClick={handleCopy}
                className="text-xs bg-white border border-green-300 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
              >
                {copied ? '복사됨!' : '복사'}
              </button>
            </div>
            <p className="text-xs text-green-600 mt-2">
              만료: {new Date(lastToken.expiresAt).toLocaleDateString('ko-KR', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </p>
          </div>
        )}
      </div>

      {/* 발급 내역 */}
      <h3 className="text-sm font-semibold text-gray-700 mb-3">발급 내역</h3>
      {loading ? (
        <div className="text-center py-8 text-gray-400">불러오는 중...</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {invites.length === 0 ? (
            <div className="py-12 text-center text-gray-400">발급된 토큰이 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">토큰</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">상태</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">만료일</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invites.map((inv) => {
                  const isUsed = !!inv.usedAt
                  const expDate = inv.expiresAt && typeof (inv.expiresAt as any).toDate === 'function'
                    ? (inv.expiresAt as any).toDate()
                    : inv.expiresAt
                      ? new Date(inv.expiresAt as string)
                      : null
                  const isExpired = expDate ? expDate < new Date() : false

                  return (
                    <tr key={inv.token} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <code className="font-mono text-gray-800 tracking-wider">{inv.token}</code>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            isUsed
                              ? 'bg-gray-100 text-gray-500'
                              : isExpired
                              ? 'bg-red-100 text-red-500'
                              : 'bg-green-100 text-green-700'
                          }`}
                        >
                          {isUsed ? '사용됨' : isExpired ? '만료' : '유효'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {expDate
                          ? expDate.toLocaleDateString('ko-KR')
                          : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
