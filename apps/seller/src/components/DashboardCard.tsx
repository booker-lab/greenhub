'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

interface DashboardCardProps {
  title: string;
  /** 지정 시 우상단에 "더보기 >" 링크를 렌더. */
  moreHref?: string;
  moreLabel?: string;
  children: ReactNode;
}

// ① 외형 유지(UI 교체 P4): Mantine Paper(radius lg·shadow xs·p md)·Group(space-between, mb sm)·Text·
// UnstyledButton과 같은 값을 Tailwind로 그린다.
const TEXT = 'm-0 p-0 text-base font-normal';

/** 홈 대시보드 카드 — 제목 + 선택적 "더보기 >" 링크 + 본문. */
export function DashboardCard({
  title,
  moreHref,
  moreLabel = '더보기',
  children,
}: DashboardCardProps) {
  return (
    <div className="block rounded-[16px] bg-white p-4 shadow-mantine-xs">
      <div className="mb-3 flex flex-row flex-wrap items-center justify-between gap-4">
        <p
          className={TEXT}
          style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--fw-bold)' }}
        >
          {title}
        </p>
        {moreHref && (
          <Link
            href={moreHref}
            className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-start text-base text-inherit no-underline [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]"
            style={{ display: 'flex', alignItems: 'center', gap: 2 }}
          >
            <p
              className={TEXT}
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-disabled)' }}
            >
              {moreLabel}
            </p>
            <ChevronRight size={14} color="var(--color-text-disabled)" />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}
