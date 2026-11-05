import { Suspense } from 'react';
import { shouldShowEmailLoginForm } from './_email-login-visibility';
import { LoginForm } from './_form';

export const dynamic = 'force-dynamic';

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const showCredentials = shouldShowEmailLoginForm(process.env, await searchParams);

  // ① 외형 유지(UI 교체 P5): Mantine Container size 400(좌우 16px)·Stack(gap lg 20·머리 gap 4·mb md 16·가운데)·
  // Title order 1(줄 높이 1.3)·Text(15px·줄 높이 1.55, 안내문 mt sm 12)와 같은 값.
  return (
    <div className="mx-auto flex min-h-screen max-w-[400px] items-center px-4">
      <div className="flex w-full flex-col items-stretch justify-start gap-5">
        <div className="mb-4 flex flex-col items-center justify-start gap-1">
          <h1
            className="m-0 text-center leading-[1.3]"
            style={{
              fontFamily: 'var(--font-brand)',
              color: 'var(--color-primary-dark)',
              fontSize: 42,
              fontWeight: 800,
              letterSpacing: '-0.01em',
            }}
          >
            Green Love
          </h1>
          <p
            className="m-0 p-0 leading-[1.55]"
            style={{
              color: 'var(--color-primary-dark)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--fw-bold)',
              letterSpacing: '0.04em',
            }}
          >
            그린러브
          </p>
          <p
            className="m-0 mt-3 p-0 text-center leading-[1.55]"
            style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}
          >
            월요일 새벽 경매, 화요일 아침 문 앞 도착
          </p>
        </div>
        <Suspense fallback={<div style={{ height: 240 }} />}>
          <LoginForm showCredentials={showCredentials} />
        </Suspense>
      </div>
    </div>
  );
}
