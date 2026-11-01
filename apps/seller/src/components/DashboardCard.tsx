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

// ② 디자인 방향(D2): 그림자와 바깥 테두리 없이 옅은 틀(bg-frame) 위 흰 면으로만 구역을 나눈다.
// 나머지(radius lg·p md·Group space-between mb sm·Text·UnstyledButton)는 ① 값을 유지한다.
const TEXT = 'm-0 p-0 text-base font-normal';

/** 홈 대시보드 카드 — 제목 + 선택적 "더보기 >" 링크 + 본문. */
export function DashboardCard({
  title,
  moreHref,
  moreLabel = '더보기',
  children,
}: DashboardCardProps) {
  return (
    <div className="block rounded-[16px] bg-white p-4">
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
