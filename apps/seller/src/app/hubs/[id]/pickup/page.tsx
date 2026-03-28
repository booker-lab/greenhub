'use client'

import { useState, useRef, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { apiFetch } from '@/lib/api'

type Step = 'input' | 'success' | 'error'

export default function HubPickupPage() {
  const { data: session } = useSession()
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()

  const hubId = params.id as string
  const orderId = searchParams.get('orderId') ?? ''

  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', ''])
  const [step, setStep] = useState<Step>('input')
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  function handleChange(index: number, value: string) {
    const char = value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[index] = char
    setDigits(next)
    if (char && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length === 6) {
      setDigits(pasted.split(''))
      inputRefs.current[5]?.focus()
    }
    e.preventDefault()
  }

  async function handleConfirm() {
    const pickupCode = digits.join('')
    if (pickupCode.length < 6) return

    const storeId = session?.user.storeId
    const token = session?.user.accessToken
    if (!storeId || !token || !orderId) return

    setLoading(true)
    setErrorMsg('')
    try {
      const res = await apiFetch(
        `/stores/${storeId}/orders/${orderId}/hub-confirm`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify({ pickupCode }),
        },
      )
      if (res.ok) {
        setStep('success')
      } else {
        const data = await res.json()
        setErrorMsg(data.message ?? '코드 확인에 실패했습니다')
        setStep('error')
        setDigits(['', '', '', '', '', ''])
        setTimeout(() => {
          setStep('input')
          inputRefs.current[0]?.focus()
        }, 2000)
      }
    } catch {
      setErrorMsg('네트워크 오류가 발생했습니다')
      setStep('error')
      setTimeout(() => setStep('input'), 2000)
    } finally {
      setLoading(false)
    }
  }

  const isFilled = digits.every((d) => d !== '')

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-gray-900">픽업 코드 확인</h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-10 flex flex-col items-center">

        {step === 'success' ? (
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <p className="text-xl font-bold text-gray-900">픽업 완료!</p>
            <p className="text-sm text-gray-500">주문이 PICKED_UP 상태로 전환되었습니다.</p>
            <button
              onClick={() => router.push(`/hubs/${hubId}`)}
              className="mt-4 bg-green-primary text-white text-sm font-medium px-6 py-3 rounded-xl"
            >
              거점으로 돌아가기
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-2 text-center">
              소비자의 픽업 코드 6자리를 입력하세요
            </p>
            <p className="text-xs text-gray-400 mb-8 text-center">
              소비자가 소비자 앱에서 확인한 코드를 제시합니다
            </p>

            {/* 6자리 입력 */}
            <div className="flex gap-2 mb-8">
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={i === 0 ? handlePaste : undefined}
                  className={`w-12 h-14 text-center text-xl font-bold rounded-xl border-2 outline-none transition-colors ${
                    step === 'error'
                      ? 'border-red-400 bg-red-50 text-red-600'
                      : digit
                        ? 'border-green-primary bg-green-50 text-green-primary'
                        : 'border-gray-200 bg-white text-gray-900 focus:border-green-primary'
                  }`}
                />
              ))}
            </div>

            {step === 'error' && errorMsg && (
              <p className="text-sm text-red-500 mb-4 text-center">{errorMsg}</p>
            )}

            <button
              onClick={handleConfirm}
              disabled={!isFilled || loading}
              className="w-full max-w-xs bg-green-primary text-white font-semibold py-3.5 rounded-xl disabled:opacity-40 transition-opacity"
            >
              {loading ? '확인 중...' : '픽업 확인'}
            </button>
          </>
        )}
      </div>
    </main>
  )
}
