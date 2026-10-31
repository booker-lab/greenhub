'use client';

import { Button, ButtonLink } from '@greenhub/ui/components/button';
import { ChevronLeft, Home } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

// ① 외형 유지(UI 교체 P4): Mantine Container 폭(xs 540·sm 720·md 960·lg 1140, 좌우 16px),
// Group(가운데 정렬·gap sm 12px), Title order 3(22px·800·1.4), ActionIcon(28px, subtle gray = ghost)과 같은 값.
const CONTAINER_WIDTH = {
  xs: 'max-w-[540px]',
  sm: 'max-w-[720px]',
  md: 'max-w-[960px]',
  lg: 'max-w-[1140px]',
  xl: 'max-w-[1320px]',
} as const;

interface PageHeaderProps {
  title: string;
  /** 지정 시 좌측에 뒤로가기 버튼을 렌더. */
  onBack?: () => void;
  /** 우측 영역 (액션 버튼·상태 표시 등). */
  right?: ReactNode;
  containerSize?: keyof typeof CONTAINER_WIDTH;
  /** false면 sticky 해제 (기본 true). */
  sticky?: boolean;
}

/** 페이지 헤더. 셀러앱 전 페이지가 동일 마크업을 공유. */
export function PageHeader({
  title,
  onBack,
  right,
  containerSize = 'sm',
  sticky = true,
}: PageHeaderProps) {
  const pathname = usePathname();
  // 홈 진입점 — 현재 경로가 홈이 아닐 때만 노출. 제목 바로 옆에 둬서 긴 제목과 겹치지 않는다.
  const showHome = pathname !== '/';

  return (
    <header
      style={{
        backgroundColor: 'var(--frame)',
        padding: '16px',
        ...(sticky ? { position: 'sticky', top: 0, zIndex: 10 } : {}),
      }}
    >
      <div className={`mx-auto px-4 ${CONTAINER_WIDTH[containerSize]}`}>
        <div className="flex flex-row flex-nowrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-row flex-nowrap items-center justify-start gap-3">
            {onBack && (
              <Button variant="ghost" size="icon-sm" className="size-7" onClick={onBack}>
                <ChevronLeft size={20} className="size-5" />
              </Button>
            )}
            <h3 className="m-0 min-w-0 text-[22px] leading-[1.4] font-extrabold">{title}</h3>
            {showHome && (
              <ButtonLink
                variant="ghost"
                size="icon-sm"
                className="size-7"
                aria-label="홈"
                render={<Link href="/" />}
              >
                <Home size={20} className="size-5" />
              </ButtonLink>
            )}
          </div>
          {right}
        </div>
      </div>
    </header>
  );
}
