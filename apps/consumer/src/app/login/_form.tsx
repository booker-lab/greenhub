'use client';

import { Alert, AlertDescription } from '@greenhub/ui/components/alert';
import { Button } from '@greenhub/ui/components/button';
import { FieldLabel } from '@greenhub/ui/components/field';
import { Input } from '@greenhub/ui/components/input';
import { LoadingButton } from '@greenhub/ui/components/loading-button';
import { PasswordInput } from '@greenhub/ui/components/password-input';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { isFeatureOn } from '@/lib/features';
import { isOrderCallback, safeCallbackPath } from './_callback-url';

// ① 외형 유지(UI 교체 P5): Mantine Stack(gap sm 12)·Button lg(radius xl)·Divider(가운데 글자 xs)·
// TextInput·PasswordInput(sm, radius 16, 라벨 15px·600과 필수 " *")·Alert light red(p sm 12)와 같은 값.
// 입력칸 묶음은 Field(role="group")를 쓰지 않고 div + 라벨(htmlFor)로 둬 접근성 이름("이메일"·"비밀번호")을 그대로 둔다.
const DIVIDER =
  "flex items-center text-xs/[1.55] whitespace-nowrap text-[#868e96] before:me-2.5 before:h-px before:flex-1 before:border-t before:border-[#dee2e6] before:content-[''] after:ms-2.5 after:h-px after:flex-1 after:border-t after:border-[#dee2e6] after:content-['']";
const FIELD_LABEL = 'cursor-default text-[15px]';

export function LoginForm({ showCredentials }: { showCredentials: boolean }) {
  const searchParams = useSearchParams();
  const rawCallbackUrl = searchParams.get('callbackUrl');
  // 같은 출처 상대 경로만 복귀 주소로 쓴다(열린 리다이렉트 방지). 출처 비교에 window가
  // 필요하므로 서버 렌더가 아닌 클릭 시점에 계산한다.
  const resolveCallbackUrl = () => safeCallbackPath(rawCallbackUrl, window.location.origin);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const emailId = useId();
  const passwordId = useId();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.');
      setLoading(false);
      return;
    }

    window.location.href = resolveCallbackUrl();
  };

  // 비회원 장바구니(guest-cart): 주문하러 온 손님에게 왜 로그인하는지 알려 준다.
  // 복귀 주소가 같은 출처 절대 주소로 오는 경우도 판정하려면 출처가 필요해, 마운트 뒤에 채운다.
  const [origin, setOrigin] = useState<string>();
  useEffect(() => setOrigin(window.location.origin), []);
  const forOrder = isFeatureOn('guest-cart') && isOrderCallback(rawCallbackUrl, origin);

  return (
    <div className="flex flex-col items-stretch justify-start gap-3">
      {forOrder && (
        <p
          role="status"
          className="m-0 text-center leading-[1.55]"
          style={{
            background: 'var(--color-primary-surface)',
            borderRadius: 'var(--radius)',
            color: 'var(--color-primary-dark)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-bold)',
            padding: '12px 16px',
          }}
        >
          주문하려면 로그인이 필요해요. 장바구니는 그대로 남아 있어요.
        </p>
      )}
      <Button
        type="button"
        size="lg"
        className="w-full"
        style={{ backgroundColor: '#FEE500', color: '#000000' }}
        onClick={() => signIn('kakao', { callbackUrl: resolveCallbackUrl() })}
      >
        카카오로 시작하기
      </Button>

      {showCredentials && (
        <>
          {/* biome-ignore lint/a11y/useSemanticElements: 글자를 품은 구분선이라 hr로 그릴 수 없다(Mantine Divider와 같은 div). */}
          <div role="separator">
            <span className={DIVIDER}>또는</span>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="flex flex-col items-stretch justify-start gap-3">
              <div>
                <FieldLabel htmlFor={emailId} required className={FIELD_LABEL}>
                  이메일
                </FieldLabel>
                <Input
                  id={emailId}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                />
              </div>
              <div>
                <FieldLabel htmlFor={passwordId} required className={FIELD_LABEL}>
                  비밀번호
                </FieldLabel>
                <PasswordInput
                  id={passwordId}
                  size="sm"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호 입력"
                />
              </div>

              {error && (
                <Alert role="alert" variant="destructive" className="p-3">
                  <AlertDescription>
                    <p className="m-0 p-0" style={{ fontSize: 'var(--font-size-sm)' }}>
                      {error}
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              <LoadingButton type="submit" loading={loading} size="lg" className="mt-2.5 w-full">
                로그인
              </LoadingButton>
            </div>
          </form>
        </>
      )}
      {isFeatureOn('guest-cart') && (
        <Link
          href="/"
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: 'var(--font-size-sm)',
            marginTop: 8,
            textAlign: 'center',
          }}
        >
          로그인 없이 더 둘러보기
        </Link>
      )}
    </div>
  );
}
