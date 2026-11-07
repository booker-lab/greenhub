'use client';

import { Button } from '@greenhub/ui/components/button';
import { Input } from '@greenhub/ui/components/input';
import { PasswordInput } from '@greenhub/ui/components/password-input';
import { useRouter } from 'next/navigation';
import { getSession, signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { kakaoCallbackUrl, postLoginPath } from '@/lib/admin-landing';

// ① 외형 유지(UI 교체 P4): Mantine Stack(gap md·sm)·Button md(radius xl, 꽉 찬 폭, 왼쪽 그림)·
// Divider(가운데 글자)·TextInput·PasswordInput md(radius xl)·Text와 같은 값.
const DIVIDER =
  "flex items-center text-xs/[1.55] whitespace-nowrap text-ui-gray-6 before:me-2.5 before:h-px before:flex-1 before:border-t before:border-ui-gray-3 before:content-[''] after:ms-2.5 after:h-px after:flex-1 after:border-t after:border-ui-gray-3 after:content-['']";

export function LoginForm({
  showCredentials,
  callbackPath,
  continueAfterLogin,
}: {
  showCredentials: boolean;
  callbackPath: string | null;
  /** 카카오 로그인에서 돌아왔을 때만 true — 열자마자 세션을 확인해 돌아갈 곳으로 보낸다. */
  continueAfterLogin: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 카카오 로그인에서 돌아온 경우에만 역할을 확인해 돌아갈 곳으로 바로 보낸다.
  // 로그아웃·계정 정지로 열린 로그인 화면에서는 세션을 조회하지 않는다. 그 요청이 지워지기 직전 쿠키를 싣고 가면
  // 세션 확인 재사용 구간 안에서 세션 쿠키를 다시 써 로그아웃을 되돌린다(원격 회차 E2E run 42391155363).
  // 토큰 오류 세션은 TokenErrorGuard가 로그아웃시킨다.
  useEffect(() => {
    if (!continueAfterLogin) return;
    let cancelled = false;
    getSession()
      .then((session) => {
        if (cancelled || !session?.user?.role || session.user.tokenError) return;
        router.replace(postLoginPath(session.user, callbackPath));
      })
      .catch(() => {
        // 조회에 실패하면 로그인 화면을 그대로 둔다.
      });
    return () => {
      cancelled = true;
    };
  }, [callbackPath, continueAfterLogin, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setLoading(false);
      setError('이메일 또는 비밀번호가 올바르지 않습니다.');
      return;
    }

    // 순수 관리자는 판매자 화면을 거치지 않고 관리자 콘솔로 간다(proxy도 같은 규칙으로 보낸다).
    // 돌아갈 경로가 있으면 역할에 맞을 때만 그리로 간다.
    const session = await getSession();
    setLoading(false);
    router.push(postLoginPath(session?.user, callbackPath));
  }

  return (
    <div className="flex flex-col items-stretch justify-start gap-4">
      <Button
        type="button"
        onClick={() => signIn('kakao', { callbackUrl: kakaoCallbackUrl(callbackPath) })}
        size="md"
        className="w-full"
        style={{ backgroundColor: '#FEE500', color: '#191919' }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="#191919"
          aria-hidden="true"
          focusable="false"
          data-icon="inline-start"
          className="size-5"
        >
          <path d="M12 3C6.477 3 2 6.477 2 10.5c0 2.59 1.524 4.868 3.842 6.26L4.5 21l4.574-2.437A11.6 11.6 0 0 0 12 18.75c5.523 0 10-3.477 10-7.5S17.523 3 12 3z" />
        </svg>
        카카오로 시작하기
      </Button>

      {showCredentials && (
        <>
          <div className={DIVIDER}>또는</div>

          <form onSubmit={handleSubmit}>
            <div className="flex flex-col items-stretch justify-start gap-3">
              <Input
                type="email"
                placeholder="이메일"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                size="md"
                className="rounded-[32px]"
              />
              <PasswordInput
                placeholder="비밀번호"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {error && (
                <p
                  className="m-0 p-0 text-center text-base"
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
                >
                  {error}
                </p>
              )}
              <Button
                type="submit"
                disabled={loading}
                size="md"
                className="w-full"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                {loading ? '로그인 중...' : '로그인'}
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
