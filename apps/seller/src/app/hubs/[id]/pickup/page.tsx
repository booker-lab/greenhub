'use client';

import { Box, Button, Container, Group, Stack, Text, Title } from '@mantine/core';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { ApiError, apiJson } from '@/lib/api';

type Step = 'input' | 'success' | 'error';

export default function HubPickupPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const hubId = params.id as string;
  const orderId = searchParams.get('orderId') ?? '';

  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [step, setStep] = useState<Step>('input');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  function handleChange(index: number, value: string) {
    const char = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    if (char && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setDigits(pasted.split(''));
      inputRefs.current[5]?.focus();
    }
    e.preventDefault();
  }

  async function handleConfirm() {
    const pickupCode = digits.join('');
    if (pickupCode.length < 6) return;

    const storeId = session?.user.storeId;
    const token = session?.user.accessToken;
    if (!storeId || !token || !orderId) return;

    setLoading(true);
    setErrorMsg('');
    try {
      await apiJson(`/stores/${storeId}/orders/${orderId}/hub-confirm`, token, {
        method: 'PATCH',
        body: JSON.stringify({ pickupCode }),
      });
      setStep('success');
    } catch (e) {
      if (e instanceof ApiError) {
        setErrorMsg(e.message);
        setStep('error');
        setDigits(['', '', '', '', '', '']);
        setTimeout(() => {
          setStep('input');
          inputRefs.current[0]?.focus();
        }, 2000);
      } else {
        setErrorMsg('네트워크 오류가 발생했습니다');
        setStep('error');
        setTimeout(() => setStep('input'), 2000);
      }
    } finally {
      setLoading(false);
    }
  }

  const isFilled = digits.every((d) => d !== '');

  return (
    <PageShell>
      <PageHeader title="픽업 코드 확인" onBack={() => router.back()} />

      <Container size="sm" px="md" py={40}>
        <Stack align="center">
          {step === 'success' ? (
            <Stack align="center" gap="md" py={40}>
              <Box
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-primary-surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth="2.5"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </Box>
              <Title order={3}>픽업 완료!</Title>
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                주문이 PICKED_UP 상태로 전환되었습니다.
              </Text>
              <Button
                onClick={() => router.push(`/hubs/${hubId}`)}
                size="md"
                radius="xl"
                mt="md"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                거점으로 돌아가기
              </Button>
            </Stack>
          ) : (
            <>
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                mb={4}
                ta="center"
              >
                소비자의 픽업 코드 6자리를 입력하세요
              </Text>
              <Text
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                mb="xl"
                ta="center"
              >
                소비자가 소비자 앱에서 확인한 코드를 제시합니다
              </Text>

              {/* 6자리 입력 */}
              <Group gap="xs" mb="xl">
                {digits.map((digit, i) => (
                  <input
                    // biome-ignore lint/suspicious/noArrayIndexKey: OTP 6자리 고정 박스 — reorder 없음
                    key={i}
                    ref={(el) => {
                      inputRefs.current[i] = el;
                    }}
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
                      fontSize: 'var(--font-size-xl)',
                      fontWeight: 700,
                      borderRadius: 12,
                      border: `2px solid ${
                        step === 'error'
                          ? 'var(--color-danger)'
                          : digit
                            ? 'var(--color-primary)'
                            : 'var(--color-border)'
                      }`,
                      backgroundColor:
                        step === 'error'
                          ? 'var(--color-danger-surface)'
                          : digit
                            ? 'var(--color-primary-surface)'
                            : 'var(--color-bg)',
                      color:
                        step === 'error'
                          ? 'var(--color-danger)'
                          : digit
                            ? 'var(--color-primary)'
                            : 'var(--color-text)',
                      outline: 'none',
                    }}
                  />
                ))}
              </Group>

              {step === 'error' && errorMsg && (
                <Text
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
                  mb="md"
                  ta="center"
                >
                  {errorMsg}
                </Text>
              )}

              <Button
                onClick={handleConfirm}
                disabled={!isFilled || loading}
                fullWidth
                maw={320}
                size="lg"
                radius="xl"
                style={{ backgroundColor: 'var(--color-primary)', fontWeight: 'var(--fw-medium)' }}
              >
                {loading ? '확인 중...' : '픽업 확인'}
              </Button>
            </>
          )}
        </Stack>
      </Container>
    </PageShell>
  );
}
