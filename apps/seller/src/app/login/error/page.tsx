import { Button } from '@greenhub/ui/components/button';
import { describeSignInError } from '@/lib/seller-invite';

export const dynamic = 'force-dynamic';

// Auth.js 로그인 오류 화면(pages.error). 로그인 거절(AccessDenied)과 초대 가입 실패 사유를 한국어로 안내한다.
export default async function SignInErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const notice = describeSignInError(Array.isArray(error) ? error[0] : error);

  // ① 외형 유지(UI 교체 P4): Mantine Container size xs·Paper(radius lg·shadow sm·p xl)·Stack(gap md)·
  // Title order 3(22px·줄 높이 1.4·800)·Text·Button outline(radius xl, 꽉 찬 폭)과 같은 값.
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
        <div className="block rounded-[16px] bg-white p-8 shadow-mantine-sm">
          <div className="flex flex-col items-stretch justify-start gap-4">
            <h3 className="m-0 text-[22px] leading-[1.4] font-extrabold">{notice.title}</h3>
            <p
              className="m-0 p-0 text-base"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              {notice.message}
            </p>
            <Button
              render={<a href="/login" />}
              nativeButton={false}
              variant="outline"
              className="w-full"
            >
              로그인 화면으로
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
