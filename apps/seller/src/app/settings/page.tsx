'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PageShell } from '@/components/PageShell';
import { useStoreSalesMode } from '@/hooks/useStoreSalesMode';
import { isFeatureOn } from '@/lib/features';
import { logout } from '@/lib/logout';
import { benchmarkSettingsLinks, operationSettingsFor } from './settings-links';

// ① 외형 유지(UI 교체 P2b): Mantine Paper·Text·UnstyledButton과 같은 값을 Tailwind로 그린다.
// Text = p(16px·줄 높이 1.55·여백 0), UnstyledButton = 배경·테두리·여백 없는 16px 왼쪽 정렬, Paper = 흰 바탕 + 모서리(그림자는 ② D2로 걷음).
const TEXT = 'm-0 p-0 text-base font-normal';
const UNSTYLED_BUTTON =
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]';

/** 설정 섹션 카드 — 작은 회색 라벨 헤더 + 행 목록. */
function SectionCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="block overflow-hidden rounded-[16px] bg-white" style={{ overflow: 'hidden' }}>
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <p
          className={TEXT}
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {label}
        </p>
      </div>
      {children}
    </div>
  );
}

const rowStyle = (borderTop: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px',
  width: '100%',
  ...(borderTop ? { borderTop: '1px solid var(--color-border)' } : {}),
});

/** 다음 화면으로 이동하는 설정 행 (chevron 표기). */
function LinkRow({
  href,
  label,
  borderTop = false,
}: {
  href: string;
  label: string;
  borderTop?: boolean;
}) {
  return (
    <Link href={href} className={UNSTYLED_BUTTON} style={rowStyle(borderTop)}>
      <p className={TEXT} style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>
        {label}
      </p>
      <ChevronRight size={16} color="var(--color-text-disabled)" />
    </Link>
  );
}

export default function SettingsPage() {
  const { data: session } = useSession();
  // 겸직 계정(어드민 + 자기 store 보유)만 관리자 콘솔 진입 노출 (#CL-52)
  const isDualRole = session?.user.role === 'admin' && !!session.user.storeId;
  const storeId = session?.user.storeId;
  const token = session?.user.accessToken;
  // 회차 판매 가게에는 적용되지 않는 예전 방식 메뉴(배송비·배송 슬롯·거점)를 숨기려고 판매 방식을 확인한다.
  const salesMode = useStoreSalesMode(storeId, token);

  return (
    <PageShell>
      <PageHeader title="설정" sticky={false} />

      <div className="mx-auto max-w-[720px] p-4">
        <div className="flex flex-col items-stretch justify-start gap-3">
          <SectionCard label="계정">
            <LinkRow href="/onboarding" label="사업자 프로필 수정" />
            <button
              type="button"
              onClick={() => void logout()}
              className={UNSTYLED_BUTTON}
              style={rowStyle(true)}
            >
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                로그아웃
              </p>
            </button>
          </SectionCard>

          {isDualRole && (
            <SectionCard label="관리자">
              <LinkRow href="/admin/stores" label="관리자 콘솔로 이동" />
            </SectionCard>
          )}

          {operationSettingsFor(salesMode).map((section) => (
            <SectionCard key={section.label} label={section.label}>
              {section.links.map((link, index) => (
                <LinkRow key={link.href} {...link} borderTop={index > 0} />
              ))}
            </SectionCard>
          ))}

          {benchmarkSettingsLinks(isFeatureOn).length > 0 && (
            <SectionCard label="고객 관리">
              {benchmarkSettingsLinks(isFeatureOn).map((link, index) => (
                <LinkRow key={link.href} {...link} borderTop={index > 0} />
              ))}
            </SectionCard>
          )}

          <SectionCard label="정보">
            <div className="flex flex-row flex-wrap items-center justify-between gap-4 p-4">
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}
              >
                앱 버전
              </p>
              <p
                className={TEXT}
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
              >
                0.1.0
              </p>
            </div>
          </SectionCard>
        </div>
      </div>
    </PageShell>
  );
}
