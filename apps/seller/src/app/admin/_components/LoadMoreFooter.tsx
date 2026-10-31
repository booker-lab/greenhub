'use client';

import { Button } from '@greenhub/ui/components/button';
import { Loader } from '@greenhub/ui/components/loader';
import type { CSSProperties } from 'react';

interface LoadMoreFooterProps {
  hasMore: boolean;
  loadingMore: boolean;
  /** 더 보기 실패 메시지. 목록은 그대로 두고 여기서 다시 시도한다. */
  moreError: string | null;
  onLoadMore: () => void;
}

// ① 외형 유지(UI 교체 P4): Mantine Stack(가운데·gap 4·mt md)·Text·Button light gray(= secondary) radius md(8px)와 같은 값.
// 불러오는 중은 Mantine Button loading처럼 면색을 두고 글자를 숨긴 채, 흐린 흰 덮개(15%·blur 12px) 위
// 가운데에 20px(높이 ÷ 1.8) 원을 돌린다. 원은 따로 합성해 그린다(will-change: transform). 정산 LoadMoreButton과 같은 방식.
const LOADING =
  "disabled:bg-[#f1f3f5] disabled:text-[#212529] before:pointer-events-none before:absolute before:inset-[-1px] before:rounded-[8px] before:bg-white/15 before:blur-[12px] before:content-[''] [&_[data-slot=button-label]]:translate-y-full [&_[data-slot=button-label]]:opacity-0";

// 관리자 목록 공통 "더 보기" — 서버가 더 있다고 알릴 때만 보인다(주문·기사 탭 공용).
export function LoadMoreFooter({
  hasMore,
  loadingMore,
  moreError,
  onLoadMore,
}: LoadMoreFooterProps) {
  if (!hasMore) return null;
  return (
    <div className="mt-4 flex flex-col items-center gap-1">
      {moreError && (
        <p
          role="alert"
          className="m-0 p-0 text-base font-normal"
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
        >
          {moreError}
        </p>
      )}
      <Button
        variant="secondary"
        onClick={onLoadMore}
        disabled={loadingMore}
        data-loading={loadingMore || undefined}
        className={`rounded-[8px] ${loadingMore ? LOADING : ''}`}
      >
        {loadingMore && (
          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 [transform:translate(-50%,calc(-50%+1px))] will-change-transform"
          >
            <Loader
              color="#212529"
              style={{ '--loader-size': '20px', '--loader-border': '2.5px' } as CSSProperties}
            />
          </span>
        )}
        {moreError ? '다시 시도' : '더 보기'}
      </Button>
    </div>
  );
}
