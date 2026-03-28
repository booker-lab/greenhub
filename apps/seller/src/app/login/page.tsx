'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    setLoading(false)

    if (result?.error) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.')
      return
    }

    router.push('/orders')
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-green-bg px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-8">
        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-green-primary mb-3">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Green Hub 판매자</h1>
          <p className="text-sm text-gray-500 mt-1">판매자 계정으로 로그인하세요</p>
        </div>

        {/* 카카오 로그인 */}
        <button
          type="button"
          onClick={() => signIn('kakao', { callbackUrl: '/orders' })}
          className="w-full flex items-center justify-center gap-2 bg-[#FEE500] text-[#191919] font-medium py-3 rounded-xl mb-4 hover:bg-[#FDD800] transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#191919">
            <path d="M12 3C6.477 3 2 6.477 2 10.5c0 2.59 1.524 4.868 3.842 6.26L4.5 21l4.574-2.437A11.6 11.6 0 0 0 12 18.75c5.523 0 10-3.477 10-7.5S17.523 3 12 3z" />
          </svg>
          카카오로 시작하기
        </button>

        <div className="flex items-center gap-3 mb-4">
          <hr className="flex-1 border-gray-200" />
          <span className="text-xs text-gray-400">또는</span>
          <hr className="flex-1 border-gray-200" />
        </div>

        {/* 이메일 로그인 */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-primary"
          />
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-green-primary"
          />
          {error && (
            <p className="text-xs text-red-500 text-center">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-primary text-white font-medium py-3 rounded-xl hover:bg-green-dark transition-colors disabled:opacity-50"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-6">
          계정이 없으신가요? 관리자에게 문의하세요.
        </p>
      </div>
    </main>
  )
}
