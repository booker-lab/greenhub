import { AuthError, CredentialsSignin } from 'next-auth';
import Image from 'next/image';
import { signIn } from '@/auth';
import { AppButton } from '@/components/app-button';
import { PasswordField, TextField } from '@/components/fields';
import { text } from '@/components/look';
import { safeDriverReturnPath, resolveDriverReturnPath } from '@/lib/login-redirect';
import { DRIVER_OPS_CONTACT } from '@/lib/ops-contact';
import { LocalCredentialForm } from './local-credential-form';
import {
  type LocalCredentialSignInResult,
  localCredentialFailurePath,
} from './local-credential-sign-in';
import { resolveDriverLoginNotice } from './login-notice';

// 로그인 뒤 돌아갈 곳(redirectTo)은 폼이 넘긴 callbackUrl을 다시 검증해 정한다. 허용하지 않으면 /board.
// 성공·실패 모두 이동할 주소만 돌려주고 폼(LocalCredentialForm)이 전체 페이지로 이동한다
// (서버 액션 안의 redirect는 클라이언트 이동이라 SessionProvider가 새 세션을 읽지 않는다).
async function localCredentialSignIn(formData: FormData): Promise<LocalCredentialSignInResult> {
  'use server';
  const returnPath = resolveDriverReturnPath(formData.get('callbackUrl'));
  try {
    await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirectTo: returnPath,
      redirect: false,
    });
  } catch (error) {
    // Auth.js 실패(authorize 거절 CredentialsSignin, authorize 안 예외를 감싼 CallbackRouteError 등)만
    // 로그인 화면 안내로 바꾼다. 승인 대기는 authorizeLocalDriver가 CredentialsSignin.code로 알린다.
    // 그 밖의 오류(Next redirect·notFound 신호 포함)는 삼키지 않고 다시 던진다.
    if (error instanceof AuthError) {
      return {
        redirectTo: localCredentialFailurePath({
          code: error instanceof CredentialsSignin ? error.code : undefined,
          returnPath,
        }),
      };
    }
    throw error;
  }
  return { redirectTo: returnPath };
}

async function kakaoSignIn(formData: FormData) {
  'use server';
  await signIn('kakao', { redirectTo: resolveDriverReturnPath(formData.get('callbackUrl')) });
}

type SearchParamValue = string | string[] | undefined;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: SearchParamValue;
    reason?: SearchParamValue;
    callbackUrl?: SearchParamValue;
  }>;
}) {
  const { error, reason, callbackUrl } = await searchParams;
  // 세션이 끝나 돌아온 경우 보던 화면 경로(같은 출처 앱 경로만). 없으면 로그인 뒤 /board로 간다.
  const returnPath = safeDriverReturnPath(callbackUrl);
  const notice = resolveDriverLoginNotice({ error, reason, hasReturnPath: returnPath !== null });
  // Local pilot runtime에서만 승인된 드라이버의 Credentials 진입을 노출한다.
  // 운영/Preview에서는 카카오 로그인만 사용한다.
  const showLocalCredentials =
    process.env.GREENHUB_LOCAL_RUNTIME === 'true' && process.env.NODE_ENV !== 'production';

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--color-bg)',
        padding: '0 16px',
      }}
    >
      <div className="w-full" style={{ maxWidth: 400 }}>
        {/* 카드: 모서리 16·안쪽 32. 그림자 대신 연한 선으로 구역을 나눈다(design-standard.md §4, 2026-10-31 사용자 결정). */}
        <div className="rounded-[16px] bg-card p-8" style={{ border: 'var(--border)' }}>
          {/* 로고 */}
          <div className="mb-8 flex flex-col items-center gap-2.5">
            <Image
              src="/icons/icon-192x192.png"
              alt="그린러브 기사 앱 아이콘"
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
              className={text}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              기사 계정으로 로그인하세요
            </p>
          </div>

          {/* 승인 대기·다른 역할·관리자 계정·로그인 실패·로그인 만료 안내 */}
          {notice && (
            // ① 외형 유지: Mantine Alert(light, radius md). 빨강은 Mantine red light, 노랑은 theme.ts의 경고 토큰이다.
            <div
              role="alert"
              className={
                notice.kind === 'failed'
                  ? 'relative mb-4 overflow-hidden rounded-[8px] border border-transparent bg-ui-red-light p-4 text-ui-red-light-text'
                  : 'relative mb-4 overflow-hidden rounded-[8px] border border-transparent bg-status-warning p-4 text-status-warning-foreground'
              }
            >
              <div className="overflow-hidden text-sm/[1.55] text-ellipsis text-ui-ink">
                <p
                  className={`${text} mb-1`}
                  style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-bold)' }}
                >
                  {notice.title}
                </p>
                <p className={text} style={{ fontSize: 'var(--font-size-sm)' }}>
                  {notice.body}
                </p>
                {notice.showOpsContact && (
                  <p className={`${text} mt-2`} style={{ fontSize: 'var(--font-size-sm)' }}>
                    {DRIVER_OPS_CONTACT.label}{' '}
                    <a
                      href={DRIVER_OPS_CONTACT.phoneHref}
                      className="font-bold underline underline-offset-2"
                    >
                      {DRIVER_OPS_CONTACT.phone}
                    </a>
                    <br />
                    운영 시간 {DRIVER_OPS_CONTACT.hours}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 카카오 로그인 */}
          <form action={kakaoSignIn}>
            {returnPath && <input type="hidden" name="callbackUrl" value={returnPath} />}
            <AppButton
              type="submit"
              fullWidth
              size="md"
              style={{ backgroundColor: '#FEE500', color: '#191919' }}
              leftSection={
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="#191919"
                  aria-hidden="true"
                  focusable="false"
                  className="size-5"
                >
                  <path d="M12 3C6.477 3 2 6.477 2 10.9c0 2.776 1.548 5.217 3.906 6.72l-.994 3.71a.25.25 0 00.375.274L9.43 19.28A11.6 11.6 0 0012 19.8c5.523 0 10-3.477 10-7.9S17.523 3 12 3z" />
                </svg>
              }
            >
              카카오로 시작하기
            </AppButton>
          </form>

          {/* 로컬 파일럿 전용: 승인된 드라이버 Credentials 진입 */}
          {showLocalCredentials && (
            <LocalCredentialForm signInAction={localCredentialSignIn}>
              {returnPath && <input type="hidden" name="callbackUrl" value={returnPath} />}
              <div className="mt-4 flex flex-col gap-3">
                {/* ① 외형 유지: Mantine Divider(label 가운데) */}
                <div className="flex items-center text-xs/[1.55] whitespace-nowrap text-ui-gray-6 before:me-2.5 before:h-px before:flex-1 before:border-t before:border-ui-gray-3 before:content-[''] after:ms-2.5 after:h-px after:flex-1 after:border-t after:border-ui-gray-3 after:content-['']">
                  또는
                </div>
                <TextField type="email" name="email" placeholder="이메일" required size="md" />
                <PasswordField name="password" placeholder="비밀번호" required />
                <AppButton
                  type="submit"
                  fullWidth
                  size="md"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  로그인
                </AppButton>
              </div>
            </LocalCredentialForm>
          )}
        </div>
      </div>
    </div>
  );
}
