import Image from 'next/image';
import { LoginForm } from './_form';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  // E2E 헤더 게이트 환경 또는 local pilot runtime에서만 Credentials form을 노출한다.
  // launcher는 local child에서 E2E_TEST를 제거하므로 local marker도 함께 확인한다.
  const showCredentials =
    process.env.E2E_TEST === 'true' ||
    (process.env.GREENHUB_LOCAL_RUNTIME === 'true' && process.env.NODE_ENV !== 'production');

  // ① 외형 유지(UI 교체 P4): Mantine Container size xs(최대 540px)·Paper(radius lg·p xl; 그림자는 ② D2로 걷음)·
  // Stack(가운데·gap xs·mb xl)·Title order 2(줄 높이 1.35)·Text(m-0 p-0)와 같은 값.
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--frame)',
        padding: '0 16px',
      }}
    >
      <div className="mx-auto w-full max-w-[540px] px-4">
        <div className="block rounded-[16px] bg-white p-8">
          <div className="mb-8 flex flex-col items-center justify-start gap-2.5">
            <Image
              src="/icons/icon-192x192.png"
              alt="그린러브 판매자 앱 아이콘"
              width={64}
              height={64}
              style={{ borderRadius: 16, display: 'block' }}
            />
            <h2
              className="m-0 leading-[1.35]"
              style={{
                fontFamily: 'var(--font-brand)',
                fontSize: 30,
                fontWeight: 800,
                letterSpacing: '-0.01em',
                color: 'var(--color-primary-dark)',
              }}
            >
              Green Love
            </h2>
            <p
              className="m-0 p-0 text-base"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              판매자 계정으로 로그인하세요
            </p>
          </div>

          <LoginForm showCredentials={showCredentials} />
        </div>
      </div>
    </main>
  );
}
