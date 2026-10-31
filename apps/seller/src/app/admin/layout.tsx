import { Badge } from '@greenhub/ui/components/badge';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isFeatureOn } from '@/lib/features';
import { AdminLogoutButton } from './_components/AdminLogoutButton';
import { AdminNav } from './_components/AdminNav';
import { buildAdminNavItems } from './_components/navItems';

// ① 외형 유지(UI 교체 P4): Mantine Container lg(1140px·좌우 16px)·Group(가운데 정렬, gap md 16·sm 12)·Text·
// Badge light red(= destructive)와 같은 값. 여백 Mantine spacing xs 10·sm 12·lg 20px.
const CONTAINER = 'mx-auto max-w-[1140px] px-4';
const TEXT = 'm-0 p-0 text-base font-normal';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user || session.user.role !== 'admin') {
    redirect('/orders');
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-surface-muted)' }}>
      <header
        style={{
          backgroundColor: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div className={`${CONTAINER} py-3`}>
          <div className="flex flex-row flex-wrap items-center justify-between gap-4">
            <p
              className={TEXT}
              style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--font-size-lg)' }}
            >
              관리자 콘솔
            </p>
            <div className="flex flex-row flex-wrap items-center justify-start gap-3">
              {/* 겸직 계정(어드민 + 자기 store 보유)만 셀러 화면 복귀 링크 노출 (#CL-52) */}
              {session.user.storeId && (
                <a
                  href="/orders"
                  className={TEXT}
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--fw-medium)',
                    color: 'var(--color-primary-dark)',
                    textDecoration: 'none',
                  }}
                >
                  셀러 화면으로
                </a>
              )}
              <Badge variant="destructive" style={{ fontWeight: 'var(--fw-medium)' }}>
                ADMIN
              </Badge>
              <AdminLogoutButton />
            </div>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div className={`${CONTAINER} pb-2.5`}>
            <AdminNav
              items={buildAdminNavItems({
                partnerInquiry: isFeatureOn('partner-inquiry'),
                reviews: isFeatureOn('reviews'),
              })}
            />
          </div>
        </div>
      </header>
      <div className={`${CONTAINER} py-5`}>{children}</div>
    </div>
  );
}
