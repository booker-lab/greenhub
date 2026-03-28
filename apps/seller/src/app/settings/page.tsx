'use client'

import { signOut, useSession } from 'next-auth/react'
import Link from 'next/link'

export default function SettingsPage() {
  const { data: session } = useSession()

  return (
    <main className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-lg mx-auto">
          <h1 className="text-lg font-bold text-gray-900">설정</h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {/* 계정 섹션 */}
        <section className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">계정</p>
          </div>
          <Link href="/onboarding" className="flex items-center justify-between px-4 py-4 hover:bg-gray-50">
            <span className="text-sm text-gray-800">사업자 프로필 수정</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex items-center justify-between w-full px-4 py-4 hover:bg-gray-50 border-t border-gray-50"
          >
            <span className="text-sm text-red-500">로그아웃</span>
          </button>
        </section>

        {/* 배송 섹션 */}
        <section className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">배송</p>
          </div>
          <Link href="/settings/delivery" className="flex items-center justify-between px-4 py-4 hover:bg-gray-50">
            <span className="text-sm text-gray-800">배송비 설정 / 기상 제한</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
          </Link>
          <Link href="/settings/daily-caps" className="flex items-center justify-between px-4 py-4 hover:bg-gray-50 border-t border-gray-50">
            <span className="text-sm text-gray-800">배송 슬롯 (Daily Cap)</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
          </Link>
        </section>

        {/* 정보 섹션 */}
        <section className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">정보</p>
          </div>
          <div className="flex items-center justify-between px-4 py-4">
            <span className="text-sm text-gray-800">앱 버전</span>
            <span className="text-sm text-gray-400">0.1.0</span>
          </div>
        </section>
      </div>
    </main>
  )
}
