import { auth, signOut } from '@/auth';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import { Card } from '@greenhub/ui/components/card';
import { cn } from '@greenhub/ui/lib/utils';
import { AppButton } from '@/components/app-button';
import { card, text, titleH4 } from '@/components/look';
import { getApiBaseUrl } from '@/lib/api-base-url';
import { profileImageSrc } from '@/lib/profile-image';

const LOGOUT_REVOKE_TIMEOUT_MS = 5_000;

/**
 * 로그아웃 전에 API의 refresh token을 폐기한다. auth()가 만료된 access token을 먼저 갱신하므로
 * 현재 access token으로 `POST /auth/logout`을 부른다. 실패해도 로그아웃은 계속한다.
 */
async function revokeApiSession(): Promise<void> {
  try {
    const current = await auth();
    const accessToken = current?.user?.accessToken;
    if (!accessToken) return;
    await fetch(`${getApiBaseUrl()}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(LOGOUT_REVOKE_TIMEOUT_MS),
    });
  } catch {
    // 응답이 없거나 늦어도 로그아웃은 계속한다. refresh token은 만료 시각에 끝난다.
  }
}

export default async function ProfilePage() {
  const session = await auth();
  if (!session) redirect('/login');

  const { user } = session;
  const imageSrc = profileImageSrc(user.image);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <header style={{ padding: '24px 16px 16px' }}>
        <h4 className={titleH4}>내 정보</h4>
      </header>

      <main style={{ flex: 1, padding: '0 16px' }}>
        <div className="flex flex-col gap-4">
          {/* 프로필 */}
          <Card className={cn(card, 'p-5')}>
            <div className="flex flex-wrap items-center gap-4">
              {imageSrc ? (
                // 카카오 CDN 사진은 이미지 최적화 허용 대상이 아니라 브라우저가 바로 받는다.
                <Image
                  src={imageSrc}
                  alt="프로필"
                  width={60}
                  height={60}
                  unoptimized
                  style={{ borderRadius: '50%' }}
                />
              ) : (
                <div
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: '50%',
                    backgroundColor: 'var(--color-primary-surface)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <p
                    className={text}
                    style={{
                      color: 'var(--color-primary-dark)',
                      fontWeight: 'var(--fw-bold)',
                      fontSize: 'var(--font-size-xl)',
                    }}
                  >
                    {user.name?.[0] ?? '기'}
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                <p className={text} style={{ fontWeight: 'var(--fw-bold)' }}>
                  {user.name ?? '기사'}
                </p>
                <p
                  className={text}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
                >
                  {user.email ?? ''}
                </p>
              </div>
            </div>
          </Card>

          {/* 계정 정보 */}
          <Card className={cn(card, 'p-0')}>
            <div className="flex flex-wrap items-center justify-between gap-4 p-4">
              <p
                className={text}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                연결된 계정
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <div
                  style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: '#FEE500' }}
                />
                <p
                  className={text}
                  style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--fw-medium)' }}
                >
                  카카오
                </p>
              </div>
            </div>
            <div className="border-t border-[#dee2e6]" />
            <div className="flex flex-wrap items-center justify-between gap-4 p-4">
              <p
                className={text}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                앱 버전
              </p>
              <p
                className={text}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                1.0.0
              </p>
            </div>
          </Card>

          {/* 로그아웃 */}
          <form
            action={async () => {
              'use server';
              await revokeApiSession();
              await signOut({ redirectTo: '/login' });
            }}
          >
            <AppButton type="submit" fullWidth tone="default" size="md">
              로그아웃
            </AppButton>
          </form>
        </div>
      </main>
    </div>
  );
}
