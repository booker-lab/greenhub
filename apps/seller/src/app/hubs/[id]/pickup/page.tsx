'use client'

import { useState, useRef, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import {
  ActionIcon,
  Box,
  Button,
  Container,
  Group,
  Stack,
  Text,
  Title,
} from '@mantine/core'

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
    <Box component="main" style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-gray-0)' }}>
      <Box
        component="header"
        style={{
          backgroundColor: 'var(--mantine-color-white)',
          borderBottom: '1px solid var(--mantine-color-gray-1)',
          padding: '16px',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Container size="sm">
          <Group gap="sm">
            <ActionIcon variant="subtle" color="gray" onClick={() => router.back()}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </ActionIcon>
            <Title order={3}>픽업 코드 확인</Title>
          </Group>
        </Container>
      </Box>

      <Container size="sm" px="md" py={40}>
        <Stack align="center">
          {step === 'success' ? (
            <Stack align="center" gap="md" py={40}>
              <Box
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  backgroundColor: 'var(--mantine-color-green-1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </Box>
              <Title order={3}>픽업 완료!</Title>
              <Text size="sm" c="dimmed">주문이 PICKED_UP 상태로 전환되었습니다.</Text>
              <Button
                onClick={() => router.push(`/hubs/${hubId}`)}
                size="md"
                radius="xl"
                mt="md"
                style={{ backgroundColor: 'var(--green-primary)' }}
              >
                거점으로 돌아가기
              </Button>
            </Stack>
          ) : (
            <>
              <Text size="sm" c="dimmed" mb={4} ta="center">
                소비자의 픽업 코드 6자리를 입력하세요
              </Text>
              <Text size="xs" c="dimmed" mb="xl" ta="center">
                소비자가 소비자 앱에서 확인한 코드를 제시합니다
              </Text>

              {/* 6자리 입력 */}
              <Group gap="xs" mb="xl">
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
                    style={{
                      width: 48,
                      height: 56,
                      textAlign: 'center',
                      fontSize: 20,
                      fontWeight: 700,
                      borderRadius: 12,
                      border: `2px solid ${
                        step === 'error'
                          ? '#F87171'
                          : digit
                            ? 'var(--green-primary)'
                            : 'var(--mantine-color-gray-3)'
                      }`,
                      backgroundColor: step === 'error'
                        ? '#FEF2F2'
                        : digit
                          ? 'var(--green-bg)'
                          : 'white',
                      color: step === 'error'
                        ? '#EF4444'
                        : digit
                          ? 'var(--green-primary)'
                          : 'var(--mantine-color-gray-9)',
                      outline: 'none',
                    }}
                  />
                ))}
              </Group>

              {step === 'error' && errorMsg && (
                <Text size="sm" c="red" mb="md" ta="center">{errorMsg}</Text>
              )}

              <Button
                onClick={handleConfirm}
                disabled={!isFilled || loading}
                fullWidth
                maw={320}
                size="lg"
                radius="xl"
                fw={600}
                style={{ backgroundColor: 'var(--green-primary)' }}
              >
                {loading ? '확인 중...' : '픽업 확인'}
              </Button>
            </>
          )}
        </Stack>
      </Container>
    </Box>
  )
}
