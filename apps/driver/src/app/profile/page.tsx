import { auth, signOut } from '@/auth';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import { Card } from '@greenhub/ui/components/card';
import { ColorSchemeSetting } from '@greenhub/ui/components/color-scheme-setting';
import { cn } from '@greenhub/ui/lib/utils';
import { card, text, titleH4 } from '@/components/look';
import { getApiBaseUrl } from '@/lib/api-base-url';
import {
  type ActiveDeliverySummary,
  logoutConfirmMessage,
  summarizeActiveDeliveries,
} from '@/lib/logout-confirm';
import { DRIVER_OPS_CONTACT } from '@/lib/ops-contact';
import { profileImageSrc } from '@/lib/profile-image';
import { LogoutButton } from './logout-button';

const LOGOUT_REVOKE_TIMEOUT_MS = 5_000;
/** 로그아웃 확인용 배송 중·보류 주문 수 조회 시간 제한. 늦으면 확인 없이 기존대로 로그아웃한다. */
const ACTIVE_DELIVERIES_TIMEOUT_MS = 3_000;

/**
 * 배송 중·보류 주문 수를 기사 목록 API 한 번으로 센다. 목록 API가 보여 주는 배송 중·보류 주문은
 * 모두 본인 배정 주문이다. 토큰이 없거나 조회가 실패·지연되면 null(확인 창 없이 로그아웃).
 */
async function readActiveDeliveries(
  accessToken: string | undefined,
): Promise<ActiveDeliverySummary | null> {
  if (!accessToken) return null;
  try {
    const response = await fetch(
      `${getApiBaseUrl()}/driver/orders?status=DELIVERING,DELIVERY_HELD`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(ACTIVE_DELIVERIES_TIMEOUT_MS),
      },
    );
    if (!response.ok) return null;
    return summarizeActiveDeliveries(await response.json());
  } catch {
    return null;
  }
}

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
  const activeDeliveries = await readActiveDeliveries(user.accessToken);

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
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--driver-text-muted)' }}
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
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--driver-text-muted)' }}
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
            <div className="border-t border-ui-gray-3" />
            {/* 화면 모드(시스템/밝게/어둡게, design-direction.md §9.3): 밤에 어둡게 맞춘 휴대폰을 낮 야외에서 밝게 쓴다 */}
            <ColorSchemeSetting className="px-4 py-2" />
            <div className="border-t border-ui-gray-3" />
            <div className="flex flex-wrap items-center justify-between gap-4 p-4">
              <p
                className={text}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--driver-text-muted)' }}
              >
                앱 버전
              </p>
              <p
                className={text}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--driver-text-muted)' }}
              >
                1.0.0
              </p>
            </div>
          </Card>

          {/* 운영팀 연락(소비자 고객센터와 같은 번호, ops-contact.ts) */}
          <Card className={cn(card, 'p-0')}>
            <div className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="flex flex-col gap-0.5">
                <p className={text} style={{ fontWeight: 'var(--fw-bold)' }}>
                  운영팀에 연락
                </p>
                <p
                  className={text}
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--driver-text-muted)' }}
                >
                  {DRIVER_OPS_CONTACT.hours}
                </p>
              </div>
              <a
                href={DRIVER_OPS_CONTACT.phoneHref}
                className="inline-flex min-h-11 items-center underline"
                style={{
                  fontSize: 'var(--font-size-md)',
                  fontWeight: 'var(--fw-bold)',
                  color: 'var(--color-text)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {DRIVER_OPS_CONTACT.phone}
              </a>
            </div>
          </Card>

          {/* 로그아웃: 배송 중·보류 주문이 있으면 확인 창을 거친다 */}
          <LogoutButton
            confirmMessage={logoutConfirmMessage(activeDeliveries)}
            action={async () => {
              'use server';
              await revokeApiSession();
              await signOut({ redirectTo: '/login' });
            }}
          />
        </div>
      </main>
    </div>
  );
}
