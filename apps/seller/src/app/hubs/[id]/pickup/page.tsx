'use client';

import { apiPathSegment, InvalidApiPathSegmentError, isSafeApiPathSegment } from '@greenhub/shared';
import { Button } from '@greenhub/ui/components/button';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { useResettableTimeout } from '@/hooks/useResettableTimeout';
import { ApiError, apiJson } from '@/lib/api';

type Step = 'input' | 'success' | 'error';

// ① 외형 유지(UI 교체 P4): Mantine Container(sm, 위아래 40px)·Stack(가운데, md 16px)·Group(xs 10px)·Text·
// Title order 3(h3 22px·800·1.4)·Button과 같은 값을 Tailwind와 @greenhub/ui로 그린다.
const TEXT = 'm-0 p-0 text-base font-normal';
const CENTER_STACK = 'flex flex-col items-center justify-start gap-4';

const INVALID_ORDER_ADDRESS_MESSAGE =
  '주문 주소가 올바르지 않습니다. 거점 화면에서 주문을 다시 선택해 주세요.';

export default function HubPickupPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const hubId = params.id as string;
  // 주소창 쿼리 값은 형식을 검사한 뒤에만 API 경로에 쓴다. 맞지 않으면 요청하지 않는다.
  const rawOrderId = searchParams.get('orderId');
  const orderId = isSafeApiPathSegment(rawOrderId) ? rawOrderId : null;

  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [step, setStep] = useState<Step>('input');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const stepResetTimer = useResettableTimeout();

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
      await apiJson(
        `/stores/${apiPathSegment(storeId)}/orders/${apiPathSegment(orderId)}/hub-confirm`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify({ pickupCode }),
        },
      );
      setStep('success');
    } catch (e) {
      if (e instanceof ApiError) {
        setErrorMsg(e.message);
        setStep('error');
        setDigits(['', '', '', '', '', '']);
        stepResetTimer.schedule(() => {
          setStep('input');
          inputRefs.current[0]?.focus();
        }, 2000);
      } else {
        setErrorMsg(
          e instanceof InvalidApiPathSegmentError ? e.message : '네트워크 오류가 발생했습니다',
        );
        setStep('error');
        stepResetTimer.schedule(() => setStep('input'), 2000);
      }
    } finally {
      setLoading(false);
    }
  }

  const isFilled = digits.every((d) => d !== '');

  return (
    <PageShell>
      <PageHeader title="픽업 코드 확인" onBack={() => router.back()} />

      <div className="mx-auto max-w-[720px] px-4 py-10">
        <div className={CENTER_STACK}>
          {step === 'success' ? (
            <div className={`${CENTER_STACK} py-10`}>
              <div
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
              </div>
              <h3 className="m-0 text-[22px] leading-[1.4] font-extrabold">픽업 완료!</h3>
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                주문이 PICKED_UP 상태로 전환되었습니다.
              </p>
              <Button
                onClick={() => router.push(`/hubs/${hubId}`)}
                size="md"
                className="mt-4"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                거점으로 돌아가기
              </Button>
            </div>
          ) : !orderId ? (
            <div className={`${CENTER_STACK} py-10`}>
              <p
                className={`${TEXT} text-center`}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
              >
                {INVALID_ORDER_ADDRESS_MESSAGE}
              </p>
              <Button onClick={() => router.push(`/hubs/${hubId}`)} size="md" variant="light">
                거점으로 돌아가기
              </Button>
            </div>
          ) : (
            <>
              <p
                className={`${TEXT} text-center`}
                style={{
                  marginBottom: 4,
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                소비자의 픽업 코드 6자리를 입력하세요
              </p>
              <p
                className={`${TEXT} text-center`}
                style={{
                  marginBottom: 32,
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                소비자가 소비자 앱에서 확인한 코드를 제시합니다
              </p>

              {/* 6자리 입력 */}
              <div className="mb-8 flex flex-row flex-wrap items-center justify-start gap-2.5">
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
                            ? 'var(--color-primary-dark)'
                            : 'var(--color-text)',
                      outline: 'none',
                    }}
                  />
                ))}
              </div>

              {step === 'error' && errorMsg && (
                <p
                  className={`${TEXT} text-center`}
                  style={{
                    marginBottom: 16,
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-danger)',
                  }}
                >
                  {errorMsg}
                </p>
              )}

              <Button
                onClick={handleConfirm}
                disabled={!isFilled || loading}
                size="lg"
                className="w-full max-w-[320px]"
                style={{ backgroundColor: 'var(--color-primary)', fontWeight: 'var(--fw-medium)' }}
              >
                {loading ? '확인 중...' : '픽업 확인'}
              </Button>
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
